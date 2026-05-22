# opencascade-fem

OpenCascade (pythonocc-core) でパラメトリック形状を組み、gmsh でメッシュ化し、
scikit-fem で線形弾性解析を行い、結果を vtk.js でブラウザに表示するサンプル。

## Stack

- **CAD**: pythonocc-core 7.9 (conda-forge)
- **Mesh**: gmsh 4.15
- **Solver**: scikit-fem 10.x + scipy.sparse.linalg.spsolve
- **API**: FastAPI + uvicorn, SSE 進捗ストリーミング
- **Frontend**: vanilla JS + vtk.js (CDN ESM)
- **Container**: micromamba ベース、~1 GB

## Quick start (local)

```bash
cd opencascade-fem
docker compose up --build
open http://localhost:8000
```

## ConoHa deploy

```bash
conoha proxy boot --acme-email you@example.com myserver
conoha app init myserver
conoha app deploy myserver
```

`conoha.yml` の `hosts:` を実際の FQDN に書き換えてください。

## Gallery

| kind | パラメータ | BC |
|------|----------|-----|
| `bracket` | base_len, base_thk, wall_h, wall_thk, width | 底面 fixed / 壁面 上端 traction +Z |
| `plate_hole` | length, width, thickness, hole_radius | 短辺 X=0 fixed / X=L 引張 +X |
| `cantilever_ibeam` | length, height, flange_w, flange_t, web_t | 壁面 X=0 fixed / 自由端 X=L 引張 +X |

## API

| Method | Path | 説明 |
|--------|------|------|
| GET | `/shapes` | ギャラリーカタログ |
| POST | `/jobs` | ジョブ投入 (JobSpec を JSON で送信) |
| GET | `/jobs/{id}/events` | SSE 進捗ストリーム |
| GET | `/jobs/{id}/result.vtu` | 解析結果 (VTU バイナリ) |

SSE イベント:

```json
{"stage": "mesh", "t_ms": 1234, "message": "meshed", "payload": {"file": "mesh.msh"}}
```

ステージ順: `queued → shape → mesh → assemble → solve → postproc → done` (失敗時は `error` で終了)。

## 環境変数

| 変数 | デフォルト | 説明 |
|------|----------|------|
| `OCFEM_MAX_CONCURRENT` | 2 | 同時実行ジョブの上限 |
| `OCFEM_MAX_ELEMENTS` | 200000 | 1 ジョブのメッシュ要素数の上限 |
| `OCFEM_SOLVER_TIMEOUT_SECONDS` | 60 | ソルバーのウォールクロック上限 |
| `OCFEM_JOB_TTL_SECONDS` | 1800 | ジョブディレクトリの保持時間 |

## 既知の制限

- 線形・小変形・等方性のみ。塑性・接触・動解析・モーダル・流体・熱は対象外。
- 加重方向は形状ごとに固定 (荷重面の外向き法線方向)。
- ジョブ状態はインメモリ。コンテナ再起動で消失。
- メッシュ要素数の上限は安全側でかなり保守的。

## References

- pythonocc-core: https://github.com/tpaviot/pythonocc-core
- gmsh: https://gmsh.info/
- scikit-fem: https://scikit-fem.readthedocs.io/
- vtk.js: https://kitware.github.io/vtk-js/
