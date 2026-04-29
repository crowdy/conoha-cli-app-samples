# GitHub PR Doc Reviewer Sample App Design

## Overview

Spec / 화면플로 / ADR 등의 문서를 한 git 레포지토리에서 운용하는 팀을 위한, **PR 단위로 문서의 낡음/부족을 자동 탐지하고 코멘트하는 AI 리뷰어** 의 conoha-cli 배포 가능한 샘플.

ConoHa VPS 위에 GitHub Actions self-hosted runner 를 띄우고, 그 러너에 `claude` CLI 를 사전 설치한다. PR 이 열리면 사용자 spec 레포의 워크플로우가 본 샘플의 Composite Action 을 호출하고, Action 이 mechanical 체크 + Claude 기반 의미 분석을 수행해 sticky 코멘트(quick 모드) 또는 인라인 PR review(deep 모드) 를 게시한다.

차별화 포인트는 다음 세 가지:

1. **Anthropic 구독 OAuth 인증** — API 키 과금 없이 사용자 Claude Pro/Max 구독 한도 내에서 동작. 토큰당 비용 걱정 없이 prompt caching 을 활용해 spec 레포 전체를 컨텍스트로 사용 가능.
2. **2 단계 모드 (`quick` / `deep`)** — 매 PR 마다 가벼운 mechanical 체크만 자동 실행하고, `deep-review` 라벨이 붙은 PR 에서만 의미 분석을 수행. 신호 대 잡음비를 의도적으로 통제.
3. **Composite Action + 데모 fixture** — 사용자가 자기 워크플로우에서 `uses:` 한 줄로 도입할 수 있도록 액션을 패키징하고, 데모용 spec 레포 fixture 를 같이 제공해 즉시 동작을 체험할 수 있다.

스택은 **myoung34/github-runner 베이스 + Bash 기반 Composite Action + claude CLI**. 기존 `github-actions-runner/` 샘플은 변경하지 않고 별도 디렉토리 `github-pr-doc-reviewer/` 에 신설.

## Directory Structure

```
github-pr-doc-reviewer/
├── README.md                       # 사용자용 메인 문서
├── compose.yml                     # 러너 + 영구 OAuth 볼륨
├── Dockerfile                      # myoung34/github-runner + claude CLI 사전 설치
├── entrypoint.sh                   # 인증 상태 점검 + 기존 entrypoint 위임
├── action/                         # Composite Action (외부 사용자 워크플로우가 참조)
│   ├── action.yml                  # 입력 정의 + 단일 step 실행
│   └── scripts/
│       ├── review.sh               # 메인 디스패처 (모드 분기)
│       ├── review-quick.sh         # mechanical 체크 + sticky 코멘트
│       ├── review-deep.sh          # mechanical + claude 의미 분석 + 인라인 review
│       ├── prompts/
│       │   ├── system.md           # claude 시스템 프롬프트 (출력 JSON 스키마 명시)
│       │   └── deep-review.md      # deep 모드 user 프롬프트 템플릿
│       ├── lib/
│       │   ├── github.sh           # gh API 헬퍼 (sticky 댓글 갱신, review 게시)
│       │   ├── markdown.sh         # TBD/빈섹션/내부 링크 체크
│       │   └── http-link.sh        # 외부 링크 HEAD 체크 (단일 retry)
│       └── fixtures/
│           └── claude-mock.json    # CLAUDE_MOCK=1 일 때 반환할 응답
├── workflow-template/
│   └── doc-review.yml              # 사용자가 자기 spec 레포에 복사할 워크플로우
├── examples/
│   └── specs-fixture/              # 데모용 spec 레포 컨텐츠
│       ├── README.md
│       ├── glossary.md
│       ├── domains/
│       │   ├── auth/
│       │   │   ├── README.md
│       │   │   ├── api.yml
│       │   │   ├── flows/login.md
│       │   │   ├── screens/login.md
│       │   │   └── data-model.md
│       │   └── checkout/
│       │       ├── README.md
│       │       ├── api.yml
│       │       ├── flows/purchase.md
│       │       └── screens/cart.md
│       └── adr/
│           └── 0001-multi-tenancy.md
├── docs/
│   ├── setup.md                    # OAuth 인증 절차
│   └── user-guide.md               # 자기 레포에 도입하는 가이드
└── tests/
    ├── markdown.bats               # mechanical 체크 단위 테스트
    └── e2e/
        ├── fixture-pr-quick.sh     # fixture 에 PR 시뮬레이션 → quick 결과 검증
        └── fixture-pr-deep.sh      # 동, deep 결과 검증 (claude mock 사용)
```

## Components & Responsibilities

### Runner Container (`Dockerfile` + `compose.yml` + `entrypoint.sh`)

**역할:** GitHub Actions self-hosted runner 의 실행 환경. 비즈니스 로직은 갖지 않는다.

**구성:**

- 베이스: `myoung34/github-runner:2.333.1` (기존 `github-actions-runner/` 샘플과 동일 버전 라인)
- 추가 사전 설치:
  - `claude` CLI (Claude Code) — `curl -fsSL https://claude.ai/install.sh | sh` 또는 npm 글로벌 설치 중 공식 권장 방식 채택. 빌드 타임에 한 번 설치.
  - `jq`, `gh` (이미 베이스에 포함된 경우 skip)
- 영구 볼륨:
  - `claude_home:/home/runner/.claude` — OAuth 토큰 영구 보존
  - `runner_work:/tmp/runner/work` — 기존 샘플과 동일
- 환경변수: `REPO_URL`, `ACCESS_TOKEN`, `RUNNER_NAME`, `RUNNER_LABELS`, `DISABLE_AUTO_UPDATE=1` (베이스와 동일)
- `entrypoint.sh`:
  1. `claude --version` 실행 가능한지 체크 (실패 시 경고만, 진행)
  2. `~/.claude/credentials.json` 존재 여부 체크 (없으면 stderr 에 안내 메시지: "초기 인증이 필요합니다. `docker exec -it <container> claude` 를 실행하세요")
  3. 기존 `myoung34/github-runner` entrypoint 에 위임

**OAuth 1 회 인증 절차 (사용자 작업):**

```bash
ssh ubuntu@<vps-ip>
docker exec -it <runner-container> claude
# → 디바이스 코드 표시 → 브라우저에서 인증 → ~/.claude/credentials.json 영구 저장
```

이후 컨테이너 재시작/재배포해도 볼륨이 유지되는 한 인증 상태 유지.

### Composite Action (`action/`)

**역할:** PR 리뷰의 비즈니스 로직 전체. 외부 사용자 워크플로우가 `uses: crowdy/conoha-cli-app-samples/github-pr-doc-reviewer/action@main` 으로 참조.

**입력 (`action.yml`):**

| 입력 | 기본값 | 설명 |
|---|---|---|
| `mode` | `quick` | `quick` 또는 `deep` |
| `paths` | `**/*.md,**/*.yml,**/*.yaml` | 리뷰 대상 글로브 (콤마 구분) |
| `glossary-path` | `glossary.md` | 용어집 파일 경로 (term consistency check 의 근거) |
| `adr-path` | `adr` | ADR 디렉토리 경로 (decision violation check 의 근거) |
| `fail-on-error` | `false` | severity=error 가 있으면 step 종료 코드 1 |
| `github-token` | `${{ github.token }}` | 코멘트 게시용 토큰 |

**`scripts/review.sh` (디스패처):**

1. `git diff --name-only origin/${{ github.base_ref }}...HEAD` 로 변경 파일 목록 수집
2. `paths` 글로브에 매칭되는 파일만 필터
3. `mode` 에 따라 `review-quick.sh` 또는 `review-deep.sh` 실행
4. 종료 코드 결정 (`fail-on-error` true 시 error 카운트 > 0 → exit 1)

**`scripts/review-quick.sh`:**

1. `lib/markdown.sh` 의 함수로 mechanical 체크
   - `check_todo_markers <file>` — `\bTBD\b|\bTODO\b|\bFIXME\b|\?\?\?` 정규식
   - `check_empty_sections <file>` — 헤더 다음 라인이 다음 헤더이거나 EOF 인 경우
   - `check_internal_links <file>` — `[label](./path)` 의 `path` 가 실재하는지 확인
   - `check_external_links <file>` — HTTP HEAD (선택, 글로브로 켤 수 있음)
2. 모든 finding 을 stdout JSON 으로 수집:
   ```json
   { "findings": [ {"path":"...","line":23,"severity":"warning","category":"todo-marker","message":"..."} ] }
   ```
3. `lib/github.sh` 의 `update_sticky_comment` 호출 — PR 의 봇 댓글을 검색 (HTML hidden marker `<!-- doc-reviewer:sticky -->`) 해 edit, 없으면 신규 작성. 본문은 마크다운 테이블.

**`scripts/review-deep.sh`:**

1. mechanical 체크 (review-quick 과 동일)
2. spec 레포 컨텍스트 빌드:
   - `glossary-path` 의 파일 전체
   - `adr-path` 의 모든 `.md` 파일 (이름순)
   - 변경된 파일 + 같은 도메인 (변경 파일의 디렉토리 prefix) 의 변경되지 않은 형제 파일들
3. PR 메타데이터 수집: `gh pr view`, `gh pr diff`
4. claude CLI 호출:
   ```bash
   echo "$user_prompt_with_context_and_diff" | \
     claude -p \
       --append-system-prompt "$(cat prompts/system.md)" \
       --output-format json \
       > "$out_json"
   ```
   `CLAUDE_MOCK=1` 일 때는 `fixtures/claude-mock.json` 을 반환 (CI 에서 단위 테스트용).
5. claude 응답 JSON 파싱 (`jq`):
   ```json
   {
     "summary": "...",
     "findings": [
       { "path":"domains/auth/flows/login.md", "line":47, "severity":"error",
         "category":"code-doc-drift", "message":"..." }
     ]
   }
   ```
6. mechanical findings + AI findings 합치기 (중복 제거: 동일 path+line+category)
7. `lib/github.sh` 의 `post_review` 호출 — `gh api /repos/.../pulls/N/reviews` 로 인라인 review 작성. `event=COMMENT`. 라인 매핑이 불가능한 finding 은 review body 의 "🔎 General findings" 섹션으로 fallback.

**프롬프트 (`prompts/system.md` 발췌):**

```
You are a documentation review assistant for a spec-as-code repository.
Output ONLY valid JSON matching this schema:
{
  "summary": "1-3 sentence overview",
  "findings": [
    {
      "path": "<repo-relative path>",
      "line": <integer or null>,
      "severity": "error" | "warning" | "info",
      "category": "code-doc-drift" | "glossary-mismatch" | "adr-violation" | ...,
      "message": "<concise actionable message in user's primary language>"
    }
  ]
}
Be conservative. Only flag findings you are highly confident about.
Prefer fewer high-quality findings over many speculative ones.
```

### Workflow Template (`workflow-template/doc-review.yml`)

사용자가 자기 spec 레포에 복사하는 reference. `deep-review` 라벨로 모드를 토글.

```yaml
name: Doc Review
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]
jobs:
  review:
    runs-on: self-hosted
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: crowdy/conoha-cli-app-samples/github-pr-doc-reviewer/action@main
        with:
          mode: ${{ contains(github.event.pull_request.labels.*.name, 'deep-review') && 'deep' || 'quick' }}
          paths: '**/*.md,**/*.yml,**/*.yaml,**/*.feature'
          glossary-path: 'glossary.md'
          adr-path: 'adr'
```

### Demo Fixture (`examples/specs-fixture/`)

도메인 2 개 (`auth`, `checkout`) 를 가진 작은 spec 레포. 일부러 다음 결함을 심어둔다:

| 파일 | 심어둔 결함 | 검출 카테고리 |
|---|---|---|
| `domains/auth/flows/login.md` | 본문에 `TBD: error case` 줄 | `todo-marker` |
| `domains/auth/screens/login.md` | `## Edge Cases` 헤더만 있고 본문 없음 | `empty-section` |
| `domains/checkout/api.yml` | 응답에 `error_code: E_PAY_99` 가 있으나 `glossary.md`/`error-codes.md` 미등록 | `glossary-mismatch` (deep 모드 전용) |
| `domains/checkout/flows/purchase.md` | `[다국어 처리](./i18n.md)` 링크의 파일이 존재하지 않음 | `broken-internal-link` |
| `adr/0001-multi-tenancy.md` 와 `domains/auth/data-model.md` | data-model 의 `users` 테이블에 `tenant_id` 없음 (ADR 0001 위배) | `adr-violation` (deep 모드 전용) |

데모 시나리오:

```bash
# 사용자가 fixture 를 자기 레포로 fork → 워크플로우 추가 → PR 만들기
# quick 모드 결과 = todo-marker, empty-section, broken-internal-link 3 건
# deep-review 라벨 추가 후 결과 = 위 3 건 + glossary-mismatch + adr-violation
```

## Data Flow (deep mode)

```
GitHub.com                                 ConoHa VPS Runner Container
─────────                                  ────────────────────────────
PR synchronize ─── webhook ──────────────► actions/runner picks up job
                                                    │
workflow: actions/checkout                          ▼
workflow: uses: .../doc-reviewer/action ───► review.sh
                                                    │
                                            ┌───────┴────────┐
                                            ▼                ▼
                                     review-quick.sh   review-deep.sh
                                            │                │
                                     mechanical checks       │
                                     (markdown.sh)           │
                                            │                │
                                            │      ┌─────────┴──────────┐
                                            │      ▼                    ▼
                                            │  context build      claude -p
                                            │  (glossary,           (uses
                                            │   adr,                ~/.claude
                                            │   sibling            credentials)
                                            │   files)               │
                                            │      │                  │
                                            │      └────► JSON ◄──────┘
                                            │            findings
                                            ▼                ▼
                                  github.sh::            github.sh::
                                  update_sticky          post_review
                                  (PR comment edit)     (inline review)
                                            │                │
                                            ▼                ▼
                                   GitHub PR comment   GitHub PR review
                                                       (with line-level
                                                        comments)
```

quick 모드 분기는 `claude` 호출 / context build 를 건너뛴다.

## Error Handling

| 상황 | 동작 |
|---|---|
| `claude` CLI 가 인증 안됨 (`~/.claude/credentials.json` 없음 또는 만료) | review.sh 가 stderr 에 안내, sticky 코멘트에 `⚠️ Doc reviewer not configured. See setup.md`. exit 0 (CI 비블로킹). |
| `claude` 응답이 JSON 파싱 실패 | retry 1 회 (동일 prompt). 재실패 시 mechanical findings 만 반영하고 review body 에 "AI 분석 실패: <stderr 발췌>" 명시. |
| `gh api` rate limit (HTTP 403/429) | 지수 백오프 (1s, 4s, 16s) 최대 3 회. 그래도 실패 시 step output `findings_json` 에 raw dump. |
| spec 레포가 거대해서 prompt 크기 초과 | review-deep.sh 가 context 빌드 단계에서 누적 byte 수 측정. 임계값 (예: 200KB) 초과 시 변경된 도메인의 sibling 만 포함하고 다른 도메인은 README 만 포함. |
| 외부 링크 (HTTP HEAD) flaky | 단일 retry. 실패는 severity=info 로 분류 (error/warning 아님). |
| `quick` 모드에서 deep 라벨이 추가됨 | `pull_request.labeled` 트리거가 워크플로우를 다시 실행. mode 가 `deep` 으로 평가되어 인라인 review 가 추가 게시 (sticky 와 공존). |
| Composite Action 이 외부 PR (fork) 에서 호출됨 | `github.token` 의 `pull-requests: write` 권한 부여 불가. action 시작 시 권한 체크해 권한 부족 시 stderr 안내 + exit 0. |

## Testing Strategy

1. **Mechanical 체크 단위 테스트 (`tests/markdown.bats`)**
   - `bats` 로 `markdown.sh` 의 함수별 테스트
   - 입력: 미리 준비한 마크다운 fixture, 출력: 기대 finding JSON
   - CI 에서 PR 마다 실행

2. **Composite Action e2e (`tests/e2e/`)**
   - GitHub Actions matrix 로 fixture 에 대해 PR 시뮬레이션
   - `CLAUDE_MOCK=1` 로 claude 응답을 결정적으로 만들고, 게시되는 review body / sticky comment 와 expected snapshot 비교
   - quick / deep 두 변형

3. **Manual smoke test (README 명시)**
   - 사용자가 fixture 를 자기 레포로 push → 워크플로우 추가 → PR → 결과 확인
   - "이 봇이 어떻게 동작하는지" 즉시 체험할 수 있는 절차로 README 에 단계별 명시

4. **러너 이미지 빌드 검증**
   - `Dockerfile` 빌드 후 `docker run --rm <image> claude --version` 이 성공하는지 CI 에서 확인
   - 베이스 이미지 버전 업그레이드 시 회귀 방지

## README Outline

1. 한 줄 설명: "PR 의 spec 문서를 AI 가 자동 리뷰하고 코멘트하는 self-hosted GitHub Actions runner"
2. 전제조건: Anthropic Pro/Max 구독, GitHub PAT (`repo` scope), conoha-cli, ConoHa VPS3 계정
3. 배포: `conoha server create` → `conoha app init` → 환경변수 설정 → `conoha app deploy`
4. 1 회성 OAuth 인증: `docker exec -it ... claude` (디바이스 코드 플로우)
5. 자기 spec 레포에 도입: workflow-template 복사, `deep-review` 라벨 생성, `runs-on: self-hosted`
6. 모드 사용법: 일반 PR → quick (자동), `deep-review` 라벨 → deep
7. 데모: fixture 를 fork → PR → 결과 확인
8. 커스터마이즈: `paths`, `glossary-path`, `adr-path`, `fail-on-error`, 추가 체크 카테고리
9. 비용 / 한도: Anthropic 구독 한도 안에서. deep 모드 PR 당 ~10–50k 토큰 예상 (prompt cache 적용 후)
10. 트러블슈팅: 인증 실패 / rate limit / 큰 spec 레포

## Out of Scope

- 다른 LLM provider (Ollama, OpenAI 등) 지원 — 추상화는 남겨두지만 첫 출시는 Claude 만
- 자동 PR 머지 / 수정 제안 (suggested change) 게시 — 첫 출시는 코멘트만
- 사용자 정의 체크 카테고리 플러그인 시스템 — 첫 출시는 고정 카테고리
- spec 레포 구조 자체의 generator (e.g., `spec init`) — 별도 도구로 분리
- 다국어 출력 자동 결정 — 코멘트 언어는 Composite Action 입력으로 지정 가능하게 두되, 첫 출시는 Claude 가 PR/문서 언어를 자동 감지

## Open Questions for Implementation Plan

- `claude` CLI 의 공식 install 명령이 무엇인지 (npm 글로벌 vs `install.sh`) — 구현 단계에서 검증
- `myoung34/github-runner` 의 root vs runner 사용자 권한 모델 — `.claude` 볼륨 소유권 처리
- Composite Action 이 PR 의 fork 일 때 `github.token` 의 권한 한계 — 명확히 문서화하고 가능하면 액션이 우아하게 실패
- prompt caching 실제 효율 측정 — 구현 후 prototype 으로 측정해 README 의 비용 추정치 갱신
