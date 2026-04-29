# github-pr-doc-reviewer

PR の spec/ 화면플로/ ADR を自動レビューする AI 搭載 GitHub Actions self-hosted runner。

`conoha-cli` で ConoHa VPS にデプロイし、開発者の spec レポジトリで PR が開かれると、文書の「古さ」「不足」「ADR との不整合」「用語ぶれ」「コード/仕様ドリフト」 などを Claude が分析して PR にコメントします。

## 構成

- **Self-hosted runner** — `myoung34/github-runner` ベース + `claude` CLI 사전 설치
- **Composite Action** — モード分岐 (`quick` / `deep`)、mechanical 체크、Claude 의미 분석、PR 코멘트 게시
- **Workflow template** — 사용자가 자기 spec 레포에 복사
- **Demo fixture** — `examples/specs-fixture/` 결함이 심어진 샘플 spec 레포
- **Anthropic subscription auth** — API 키 불필요. Pro/Max 구독 한도 안에서 동작

## 前提条件

- conoha-cli 설치 완료
- ConoHa VPS3 계정 + SSH 키페어
- GitHub Personal Access Token (`repo` scope)
- Anthropic Pro 또는 Max 구독

## デプロイ

```bash
conoha server create --name doc-reviewer --flavor g2l-t-2 --image ubuntu-24.04 --key mykey
conoha app init doc-reviewer --app-name github-pr-doc-reviewer
conoha app env set doc-reviewer --app-name github-pr-doc-reviewer \
  REPO_URL=https://github.com/your-org/your-spec-repo \
  ACCESS_TOKEN=ghp_xxxxxxxxxxxx
conoha app deploy doc-reviewer --app-name github-pr-doc-reviewer
```

## 1 회성 인증

```bash
ssh ubuntu@<vps-ip>
docker exec -it $(docker ps -qf name=runner) claude
# 디바이스 코드 → 브라우저 인증 → ~/.claude/ 에 영구 저장
```

## 사용법 요약

- 일반 PR → `quick` 모드 자동 실행 → sticky 코멘트로 mechanical findings
- `deep-review` 라벨 부착 → `deep` 모드 → Claude 분석 + 인라인 PR review

자세한 사용법은:

- [docs/setup.md](docs/setup.md) — 셋업 절차
- [docs/user-guide.md](docs/user-guide.md) — 사용 가이드 + 데모
- [examples/specs-fixture/](examples/specs-fixture/) — 데모용 샘플 spec 레포

## カスタマイズ

워크플로우의 입력 파라미터로 동작 조정:

```yaml
- uses: crowdy/conoha-cli-app-samples/github-pr-doc-reviewer/action@main
  with:
    mode: deep
    paths: '**/*.md,**/*.yml,**/*.feature'
    glossary-path: 'docs/glossary.md'
    adr-path: 'docs/adr'
    fail-on-error: 'true'
```

전체 입력은 [`action/action.yml`](action/action.yml) 참조.

## 비용

- Quick 모드: LLM 호출 없음 (무료)
- Deep 모드: Anthropic 구독 한도 내. PR 당 ~10–50k 입력 토큰 + ~1–2k 출력 토큰 추정 (prompt cache 적용 후)

## ライセンス

リポジトリ全体の LICENSE に従う。
