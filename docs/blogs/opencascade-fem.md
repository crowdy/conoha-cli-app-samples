---
title: conoha-cli で OpenCascade + scikit-fem の CAE Web アプリを VPS 1 台にデプロイ — CAD→メッシュ→FEM→ブラウザ可視化を一発で
tags: ConoHa conoha-cli OpenCascade scikit-fem FEM
author: crowdy
slide: false
---

## はじめに

ConoHa VPS3 にお馴染みの `conoha-cli` で **CAE（Computer-Aided Engineering）の風通しの良いデモ** を一発デプロイしてみました。お題は「**CAD 形状を作って → メッシュを切って → 線形弾性 FEM を解いて → ブラウザで結果を 3D 表示**」という、本来なら商用 CAE ソフトの中で完結する流れを、**全部オープンソース + 単一 Docker コンテナ + g2l-t-c3m2 (2 GB) インスタンス** で再現するというものです。

サンプル一式: [crowdy/conoha-cli-app-samples — opencascade-fem](https://github.com/crowdy/conoha-cli-app-samples/tree/main/opencascade-fem)
ライブデモ: https://opencascade-fem.crowdy.dev/

![screenshot](https://raw.githubusercontent.com/crowdy/conoha-cli-app-samples/main/opencascade-fem/docs/screenshot.png)

主な構成:

- **CAD**: pythonocc-core 7.9（OpenCascade の Python バインディング、conda-forge）
- **Mesh**: gmsh 4.15（OpenCascade ジオメトリを取り込んで四面体メッシュ生成）
- **Solver**: scikit-fem 10.x + `scipy.sparse.linalg.spsolve`（線形弾性、CPU）
- **API**: FastAPI + uvicorn、進捗は Server-Sent Events で逐次配信
- **Frontend**: vanilla JS + vtk.js（CDN ESM、importmap で依存解決）
- **Container**: micromamba ベース、約 1 GB の単一イメージ

ジョブ 1 件あたりの典型タイミング（メッシュサイズ 20 mm、デフォルトの L 字ブラケット）は次のとおりで、g2l-t-c3m2 でも快適に回ります:

| ステージ | 時間 |
|---|---|
| OpenCascade 形状ビルド | < 0.1 s |
| gmsh メッシュ生成 | 0.5–2 s |
| K 組み立て + spsolve | 0.1–0.5 s（636 DOF で 0.16 s 実測） |
| VTP 直列化 | 0.05 s |
| **合計** | **~1 s** |

「**ConoHa VPS3 に CAE 全部入りデモを 1 コマンドで立てる**」というのが本記事の本題、後半の `vtk.js × ESM importmap` の沼話はサイドディッシュです。

---

## 想定読者

- Python で CAD を扱ったことがある、または OpenCascade に興味がある方
- 「scikit-fem ってどこまで実用に耐えるの？」と気になっていた方
- conoha-cli で「ちょっと珍しいスタックをサクッと立ててみたい」方
- CAE ソフトを買う前に **最小構成のリファレンス** が欲しい方

---

## アーキテクチャ

シンプルな単一コンテナ構成です。proxy 経由で HTTPS 終端、`/jobs` でジョブを投げ、`/jobs/<id>/events` で SSE を購読し、`/jobs/<id>/result.vtp` で結果を取りに行きます。

```
                  HTTPS (conoha-proxy + Let's Encrypt)
                              │
                              ▼
              ┌──────────────────────────────────┐
              │  FastAPI + uvicorn (port 8000)   │
              │                                  │
              │  app/web/    static SPA          │
              │   ├─ index.html (importmap)      │
              │   └─ app.js     (vtk.js)         │
              │                                  │
              │  app/api/                        │
              │   ├─ POST /jobs                  │
              │   ├─ GET  /jobs/{id}/events  SSE │
              │   ├─ GET  /jobs/{id}/result.vtp  │
              │   └─ GET  /shapes                │
              │                                  │
              │  app/core/                       │
              │   ├─ shapes  (pythonocc-core)    │
              │   ├─ meshing (OCC → STEP → gmsh) │
              │   ├─ solver  (scikit-fem)        │
              │   ├─ vtu     (VTP writer)        │
              │   └─ jobs    (in-memory queue)   │
              └─────────────┬────────────────────┘
                            │
                            ▼
                  /app/jobs/<id>/   per-job work dir
```

ジョブは **`asyncio.Queue` ベースのインメモリキュー**で、SSE で `queued → shape → mesh → assemble → solve → postproc → done` の 7 ステージを順に流します。CPU バウンドな OCC / gmsh / scipy の各処理は `loop.run_in_executor` でスレッドプールに飛ばし、イベントループは SSE 配信に集中します。

---

## Quick start

`conoha-cli` 設定済み・SSH キー登録済み前提です。

```bash
# 1. VPS を作成
conoha server create \
  --name opencascade-fem \
  --flavor g2l-t-c3m2 \
  --image vmi-docker-29.2-ubuntu-24.04-amd64 \
  --key-name your-key \
  --security-group default \
  --security-group IPv4v6-SSH \
  --security-group IPv4v6-Web \
  --no-input --yes --wait

# 2. DNS A レコードを VPS の IP に向ける（Cloudflare 等）
#    例: opencascade-fem.example.com → <IP>

# 3. proxy 起動（初回のみ）
conoha proxy boot --acme-email you@example.com opencascade-fem --no-input --yes

# 4. conoha.yml の hosts を自分のドメインに書き換える
#    cd opencascade-fem
#    sed -i 's|opencascade-fem.example.com|opencascade-fem.crowdy.dev|' conoha.yml

# 5. デプロイ
conoha app init   opencascade-fem --no-input --yes
conoha app deploy opencascade-fem --no-input --yes
```

ビルドは初回 4–10 分（pythonocc-core と gmsh の conda レイヤーが重い）、二回目以降は app/ レイヤーだけリビルドされるので 30 秒程度。デプロイが終わったらブラウザで `https://<FQDN>/` を開くと、形状を選んで Run するだけで CAE 解析が走ります。

---

## ギャラリー — 3 つのパラメトリック形状

ユーザーが STEP/IGES ファイルをアップロードする方式は VPS の安定性を脅かす（メッシュ生成失敗や巨大ファイルでの OOM が読めない）ので、**OpenCascade パラメトリックビルダーで作る 3 種のギャラリー** に絞っています:

| kind | 形状 | 境界条件 |
|------|------|----------|
| `bracket` | L 字補強ブラケット | 底面 fixed、壁面上端に荷重 +Z |
| `plate_hole` | 中央に円穴がある板 | X=0 fixed、X=L 引張 +X |
| `cantilever_ibeam` | 単純な I 断面の片持ち梁 | 壁面 X=0 fixed、自由端 X=L 引張 +X |

各形状は pythonocc-core で `BRepPrimAPI_MakeBox` / `BRepAlgoAPI_Fuse` / `BRepAlgoAPI_Cut` を組み合わせて作り、境界面は `TopExp_Explorer` で平面の法線方向と位置から拾います。境界面の **face index は gmsh の `importShapes` 後のサーフェスタグ順と一致する**（pythonocc 7.9 と gmsh 4.15 の組み合わせで実機検証済み）ので、物理グループ "fixed" / "load" を素直にタグ付けできます。

---

## 検証 — 解析解との突き合わせ

数値ソフトをデモとして見せるとき、何より大事なのは「**本当に正しい答えを出しているのか**」です。pytest の `@pytest.mark.slow` テストとして 2 種類のベンチマークを置きました:

### 1. 軸引張 — δ = PL/E

`plate_hole` を引張試験片に見立てて、ファセット積分の traction を適用。アスペクトの薄い板（L=200, W=40, T=5, 微小穴 R=1）に均一引張 P=1 MPa をかけ、自由端の平均変位が解析解 `δ = (P/E)·L = 1.0e-3 mm` と **5 % 以内** で一致するかを確認します:

```python
@pytest.mark.slow
def test_axial_stretch_matches_PL_over_E_within_5_percent(tmp_path):
    params = {"length": 200.0, "width": 40.0, "thickness": 5.0, "hole_radius": 1.0}
    shape, tags = S.build("plate_hole", params)
    msh = M.mesh(shape, tags, mesh_size=4.0, work_dir=tmp_path)
    mat = F.Material(E_GPa=200.0, nu=0.3)
    result, mesh = F.solve(msh, mat, traction_MPa=1.0)

    delta_analytic = (1.0 / (mat.E_GPa * 1e3)) * params["length"]
    p = mesh.p.T
    loaded = np.where(np.abs(p[:, 0] - params["length"]) < 0.1)[0]
    measured_ux = float(result.displacement[loaded, 0].mean())
    assert measured_ux == pytest.approx(delta_analytic, rel=0.05)
```

実測 1.00e-03 mm、解析解 1.00e-03 mm、誤差 < 1 % で **PASS**。これでソルバーの「変位の絶対値が正しい」ことは担保されました。

### 2. Kirsch — 穴あき板の応力集中 K ≈ 3

無限板の Kirsch 解析解では、均一引張下の円穴縁で **応力集中係数 K = σ_peak / σ_nominal が 3** になります。我々の板は有限サイズ（W/R = 10）なので少し下がり、メッシュも粗いので少し下がる、という両方の効果を見越して許容範囲 `1.8 ≤ K ≤ 4.5` でテスト:

```python
@pytest.mark.slow
def test_plate_hole_stress_concentration_factor_near_three(tmp_path):
    params = {"length": 200.0, "width": 80.0, "thickness": 5.0, "hole_radius": 8.0}
    shape, tags = S.build("plate_hole", params)
    msh = M.mesh(shape, tags, mesh_size=3.0, work_dir=tmp_path)
    mat = F.Material(E_GPa=200.0, nu=0.3)
    result, _ = F.solve(msh, mat, traction_MPa=10.0)

    K = float(result.von_mises.max()) / 10.0
    assert 1.8 <= K <= 4.5, f"got K={K:.2f}"
```

実測 **K = 2.41**、ピーク位置は **穴のエッジ上**（X=L/2, Y=W/2 ± R）— 物理的に正しい場所。これでソルバーの「応力分布の形が正しい」ことも担保されました。

`pytest -v` で 18/18 テストが緑になります。CAE ライブラリを使ったデモにありがちな **「結果は綺麗だけど数値が合ってない」を未然に潰す装置** として、この 2 本のベンチマークは強くおすすめです。

---

## VTP（PolyData）出力という選択

「scikit-fem のテト体積メッシュをそのまま VTU で出して、vtk.js で読ませよう」と最初は素直に考えたのですが、これが落とし穴で:

> **vtk.js（最新の v36 含めて）に `XMLUnstructuredGridReader` は存在しない**。

vtk.js の I/O は PolyData 系（VTP, STL, PLY, GLTF...）に絞られていて、Unstructured Grid のリーダーはありません。回避策として、**境界三角形だけを抽出して VTP（XML PolyData）にエクスポート** する設計に切り替えました:

```python
# app/core/vtu.py — boundary surface のみ書き出し
def write(result, mesh, path: Path) -> None:
    points = mesh.p.T.astype(np.float32)
    boundary_idx = mesh.boundary_facets()
    boundary_triangles = mesh.facets.T[boundary_idx].astype(np.int32)
    point_data = {
        "displacement": result.displacement.astype(np.float32),
        "displacement_magnitude": np.linalg.norm(result.displacement, axis=1).astype(np.float32),
        "von_mises": result.von_mises.astype(np.float32),
    }
    # meshio 5.3 は VTP write に対応しないため、手書きの XML PolyData writer を使用
    _write_vtp(points, boundary_triangles, point_data, path)
```

表面しか出ないので「内部の応力分布」は見えませんが、ブラケット・穴あき板・I 梁ともピーク応力は表面に出るので、デモ用途では支障ありません。WarpVector フィルタ（変形可視化）も vtk.js v30 / v36 にはないため、ブラウザ側で `BufferGeometry` の頂点座標を `restPoints + scale * displacement` で直接ずらす実装に置き換えました。

---

## サイドディッシュ — vtk.js を ESM でロードするまでの 7 つの罠

ここから先は CAE 本体とは別レイヤーの、**フロントエンドの依存解決まわりで踏んだ落とし穴のクロニクル** です。Pure-Python の世界と比べて、ブラウザ ESM × CDN × CommonJS パッケージの組み合わせは、想像以上にエッジケースだらけでした。

| # | 罠 | 対処 |
|---|----|------|
| F1 | `vtk.js` を CDN UMD 経由でロードする想定で組んだら、**そもそも UMD ビルドが npm に公開されていない**。jsdelivr の `/vtk.js` は ES Module で `<script src>` で読むと SyntaxError | `<script type="module">` に切り替え、ESM 経路で行く |
| F2 | esm.sh の subpath import (`@kitware/vtk.js/Sources/...`) が **"could not resolve build entry"** で 404 | jspm.io に切り替え（`https://ga.jspm.io/npm:@kitware/vtk.js@30.10.0/IO/XML/XMLPolyDataReader.js`） |
| F3 | jspm.io 経由でロードすると vtk.js 内部の `import "fast-deep-equal"` が **bare specifier を解決できない** | `<script type="importmap">` を導入し、jspm Generator API で **依存全部のマッピングを生成**してインライン展開 |
| F4 | jspm の `xmlbuilder2@3.0.2` は **named export `create` を持たない**（webpack UMD bundle として配布されているため）。vtk.js は `import { create } from 'xmlbuilder2'` を要求 | importmap で xmlbuilder2 だけ **jsdelivr の `xmlbuilder2@4.0.3/+esm` に override**（named exports が揃っている） |
| F5 | `vtkFullScreenRenderWindow.newInstance()` が `TypeError: Cannot read properties of undefined (reading 'traverse')` で落ちる | `import "@kitware/vtk.js/Rendering/Profiles/Geometry.js"` を副作用 import で先頭に追加（WebGL バックエンドを登録） |
| F6 | バックエンドで `POST /jobs` が `PermissionError: '/tmp/jobs/...'` で 500 | Docker volume の root 所有問題。`OCFEM_JOB_DIR=/app/jobs`（mambauser 所有の WORKDIR 配下）に変更 |
| F7 | proxy の health probe が `/up` を叩いて 404、active slot に昇格しない | FastAPI に `/up` を追加。**`@app.get` を 2 段スタックするとデコレータが合成されない**ので、`/health` と `/up` を別関数として宣言 |

ESM/CommonJS 変換まわりは、`?bundle` で全部固めた CDN URL を 1 本貼って終わりにできれば一番楽なのですが、vtk.js のように **依存ツリーがそこそこ深い CommonJS パッケージ**を組み合わせると、こうやって 1 個ずつ穴をふさぐことになりがちです。結果的に手書きの importmap が一番安定で、再現性も高いという結論でした。

---

## まとめ

最終的に手に入ったもの:

| 機能 | 状況 |
|------|------|
| CAD パラメトリック生成 → メッシュ → 線形弾性 FEM → ブラウザ 3D 可視化 | `conoha app deploy` 1 発で `https://<FQDN>/` に立つ |
| 解析解とのベンチマーク 2 本（軸引張 ±5 %、Kirsch K=2.41） | `pytest -v` で 18/18 グリーン |
| SSE 進捗ストリーミング（7 ステージ） | EventSource で逐次配信、ジョブ 1 件 ~1 s |
| 表面 PolyData 経由のブラウザ 3D（warp + von Mises） | importmap 経由の vtk.js |
| 全部入りで g2l-t-c3m2 (2 GB) | 単一コンテナ、~1 GB イメージ |

`conoha-cli` のおかげで、**「珍しいスタックを VPS で動かす」コスト** がだいぶ下がりました。pythonocc-core みたいに「conda-forge にしか居ない」依存があっても、Dockerfile に micromamba ベースを 1 行書くだけで、あとは `conoha app deploy` が全部やってくれます。

CAE は普段 Linux ワークステーション + 商用ソフトの世界に閉じがちですが、**学習用・デモ用・小規模な検証**くらいの粒度なら、こうしてオープンソースで組んで VPS 1 台で完結させた方が、後でブラウザ URL 共有するだけで議論できるので便利です。GitHub の issue / PR でフィードバックいただけるとうれしいです。

### 参考

- [crowdy/conoha-cli-app-samples — opencascade-fem サンプル](https://github.com/crowdy/conoha-cli-app-samples/tree/main/opencascade-fem)
- [PR #108 — feat(opencascade-fem): OpenCascade + scikit-fem FEM sample](https://github.com/crowdy/conoha-cli-app-samples/pull/108)
- [pythonocc-core — Python bindings for OpenCascade](https://github.com/tpaviot/pythonocc-core)
- [gmsh — A three-dimensional finite element mesh generator](https://gmsh.info/)
- [scikit-fem — Simple finite element assemblers (10.x)](https://scikit-fem.readthedocs.io/)
- [Kitware vtk.js](https://kitware.github.io/vtk-js/)
- [jspm Generator — Online importmap generator](https://generator.jspm.io/)
- [crowdy/conoha-cli - GitHub](https://github.com/crowdy/conoha-cli)
- [CLIひとつでVPSデプロイ完了 — conoha-cliとClaude Code Skillで変わるインフラ構築（note.com）](https://note.com/kim_tonghyun/n/n77b464a61dc0)
