/**
 * harness-backend.mjs — 백엔드 빌드 오케스트레이션 하니스
 * ---------------------------------------------------------------------------
 * 이 파일은 직접 node로 실행하는 스크립트가 아니라, Claude Code의 Workflow 런타임이
 * 실행하는 "오케스트레이션 스크립트"다. docs/build-prompts/be/01~07 프롬프트를
 * 하나로 "합치지" 않고, 각각을 독립 서브에이전트로 "지휘"한다:
 *
 *   phase 1  be/01 파운데이션      (하드 의존성 — 먼저 단독 실행)
 *   phase 2  be/02~07 6개 기능     (각자 폴더만 소유 → 병렬, 충돌 0)
 *   phase 3  통합 스모크           (scripts/test_pipeline.py --inproc 로 f1→f6 확인)
 *
 * 실행: Claude Code에서  Workflow({ scriptPath: "harness-backend.mjs" })
 *   또는 그냥 "백엔드 하니스 돌려줘" 라고 요청하면 된다.
 * 비고: 프롬프트 텍스트를 복사/병합하지 않는다. 각 에이전트가 자기 .md를 직접 읽고
 *      그 안의 "## 프롬프트" 지시를 실행한다(단일 소스 유지).
 */
export const meta = {
  name: 'build-backend',
  description: '백엔드 빌드 프롬프트(be/01~07)를 파운데이션→기능 병렬→통합 스모크로 오케스트레이션',
  phases: [
    { title: 'Foundation', detail: 'be/01 백엔드 스캐폴드 (모두가 의존)' },
    { title: 'Features', detail: 'be/02~07 6개 기능 병렬 빌드' },
    { title: 'Smoke', detail: 'scripts/test_pipeline.py --inproc 로 f1→f6 통합 확인' },
  ],
}

const PROMPT_DIR = 'docs/build-prompts/be'

// 병렬 대상 — 각 기능은 자기 backend/app/features/<도메인>/ 와 지정된 shared 파일만 소유한다.
const FEATURES = [
  { file: '02-f1-structure.md', label: 'be/02 f1-structure' },
  { file: '03-f2-plan.md',      label: 'be/03 f2-plan' },
  { file: '04-f3-inp.md',       label: 'be/04 f3-inp' },
  { file: '05-f4-jobs.md',      label: 'be/05 f4-jobs' },
  { file: '06-f5-report.md',    label: 'be/06 f5-report' },
  { file: '07-f6-benchmark.md', label: 'be/07 f6-benchmark' },
]

function runPrompt(file) {
  return [
    '너는 해커톤 모노레포의 백엔드 빌드 작업자다.',
    '먼저 repo 루트의 CLAUDE.md(프로젝트 헌법)를 읽고 그 규칙을 따른다.',
    `그다음 ${PROMPT_DIR}/${file} 를 읽고, 그 안의 "## 프롬프트" 섹션 지시를 그대로 실행한다.`,
    '그 프롬프트가 참조하라는 docs(backend-structure.md, contracts/data-models.md, features/<도메인>/api.md, MVP-SCOPE.md)를 단일 소스로 삼는다.',
    '소유 규칙: 해당 기능의 backend/app/features/<도메인>/ 와 그 프롬프트가 지정한 shared 파일만 생성/수정한다.',
    '다른 기능 폴더나 공유 골격(app/core, app/schemas, app/main.py)은 건드리지 않는다.',
    '계약에 없는 필드를 임의로 추가하지 않는다. 비밀키 하드코딩 금지(.env만).',
    '완료되면 그 프롬프트의 완료 정의(DoD)를 점검하고, 생성/수정한 파일 목록과 DoD 통과 여부를 보고한다.',
  ].join('\n')
}

phase('Foundation')
log('be/01 백엔드 파운데이션 스캐폴드 (하드 의존성 — 먼저 단독 실행)')
await agent(runPrompt('01-foundation.md'), { label: 'be/01 foundation', phase: 'Foundation' })

phase('Features')
log('be/02~07 6개 기능 병렬 빌드 (각자 폴더만 소유 → 충돌 0)')
await parallel(
  FEATURES.map((f) => () => agent(runPrompt(f.file), { label: f.label, phase: 'Features' }))
)

phase('Smoke')
log('통합 스모크: scripts/test_pipeline.py --inproc 로 f1→f6 end-to-end 확인')
await agent(
  [
    '백엔드 빌드가 끝났다. 통합 스모크 테스트를 수행한다(코드는 수정하지 말고 결과만 보고).',
    '1) backend/requirements.txt 의존성이 설치돼 있는지 확인하고, 없으면 설치한다.',
    '2) backend/ 에서  python scripts/test_pipeline.py --inproc  를 실행한다(서버 없이 인프로세스 TestClient).',
    '3) f1→f6 각 단계의 출력/에러를 수집해 요약하고, 실패 단계가 있으면 원인과 위치(file:line)를 보고한다.',
  ].join('\n'),
  { label: 'smoke test_pipeline', phase: 'Smoke' }
)

log('✅ 백엔드 빌드 하니스 완료')
