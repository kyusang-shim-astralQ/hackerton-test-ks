# 백엔드 디렉토리 구조 (Backend Structure)

> 목적: 해커톤 백엔드를 도메인별 **package-by-feature** 구조로 통일하여, 기능 단위로 코드 위치를 예측 가능하게 만들고 병렬 작업 충돌을 최소화한다.

## 1. 폴더 트리

```
backend/
  app/
    main.py                  # FastAPI 앱: 라우터 등록, 미들웨어, 정적 서빙 (얇게)
    core/
      config.py              # env/설정
      sge.py                 # SSH/SGE 클라이언트(paramiko): CLUSTER_* 접속·SFTP·run.sh 생성·qsub/qstat/qdel
      llm.py                 # Anthropic 클라이언트 래퍼
    schemas/
      common.py              # cross-feature 계약 = data-models.md 의 코드본
    shared/                  # 여러 기능이 공유하는 도메인 엔진/유틸
      schema_engine.py
      self_healing.py
      physics_rules.py
      options.py             # parse_path_based_options, merge_custom_options, deep_merge
      physics_patterns.py    # PHYSICS_PATTERNS
    features/
      structure/   router.py  service.py  schemas.py            # f1 (analyzer + kp cache)
      plan/        router.py  service.py  schemas.py  prompts.py # f2
      inp/         router.py  service.py  schemas.py            # f3 (build_full_inp 소유)
      jobs/        router.py  service.py  schemas.py            # f4 (구 orchestrator)
      report/      router.py  service.py  schemas.py  prompts.py # f5
      benchmark/   router.py  service.py  schemas.py            # f6
```

## 2. 파일 역할 규약

각 파일/디렉토리는 단일한 책임을 가진다.

| 파일/경로 | 역할 |
| --- | --- |
| `router.py` | HTTP 입출구. 엔드포인트(경로/메서드) 정의, 요청 파싱·검증 위임, 응답 직렬화만 담당하고 비즈니스 로직은 가지지 않는다. |
| `service.py` | 비즈니스 로직. 해당 기능의 실제 처리·계산·외부 연동을 수행한다. |
| `schemas.py` | 그 기능 **전용** Pydantic 모델(요청/응답 등). 다른 기능과 공유하지 않는다. |
| `app/schemas/common.py` | **cross-feature 계약**. 여러 기능이 공유하는 데이터 모델. `data-models.md`의 코드본(=구현체)이다. |
| `app/shared/*` | 여러 기능이 함께 쓰는 도메인 엔진/유틸(schema_engine, self_healing, physics_rules, options, physics_patterns). |
| `app/core/*` | 인프라/설정 레이어. 설정(config), SSH/SGE 클라이언트(sge — paramiko, 클러스터 제출), LLM 클라이언트(llm). |

## 3. 레거시 → 새 구조 매핑

레거시 flat 구조에서 새 도메인(package-by-feature) 구조로의 이동 매핑.

| 레거시 (flat) | 새 위치 (package-by-feature) |
| --- | --- |
| `main.py` (앱 부트스트랩) | `app/main.py` (라우터 등록/미들웨어/정적 서빙) |
| 각 엔드포인트 라우트 핸들러 | `app/features/<도메인>/router.py` |
| `analyzer.py` | `app/features/structure/service.py` |
| `cache_manager.py` (kp_cache) | `app/features/structure/service.py` |
| `generator.generate_plan_logic` | `app/features/plan/service.py` |
| `generator.generate_inp_logic`, `generator.build_full_inp` | `app/features/inp/service.py` |
| `generator.parse_path_based_options`, `merge_custom_options`, `deep_merge` | `app/shared/options.py` |
| `generator.PHYSICS_PATTERNS` | `app/shared/physics_patterns.py` |
| `orchestrator.py` | `app/features/jobs/service.py` |
| `orchestrator.SGE_TEMPLATE` / qsub 래퍼 | `app/core/sge.py` |
| `reporter.py` | `app/features/report/service.py` |
| `benchmark_manager.py` | `app/features/benchmark/service.py` |
| `self_healing.py` | `app/shared/self_healing.py` |
| `physics_rules.py` | `app/shared/physics_rules.py` |
| `schema_engine.py` | `app/shared/schema_engine.py` |
| `prompts.py` (플랜용) | `app/features/plan/prompts.py` |
| `prompts.py` (리포트용) | `app/features/report/prompts.py` |
| `models.py` — cross-feature 모델(AtomInfo, PlanStep, GeneratedFile, JobStatus 등) | `app/schemas/common.py` |
| `models.py` — 기능 전용 요청 모델 | `app/features/<도메인>/schemas.py` |
| Anthropic 클라이언트 | `app/core/llm.py` |

## 4. 네이밍/소유 규칙

- **한 기능 = 한 `features/<도메인>` 폴더 = 한 명 소유.** 도메인 폴더는 그 기능 담당자의 단독 작업 공간이며, 다른 기능 폴더를 건드릴 일이 없어 병렬 작업 시 충돌이 최소화된다.
- 폴더 안의 파일은 역할 규약(`router.py` / `service.py` / `schemas.py` / 필요 시 `prompts.py`)을 그대로 따른다.
- **공유물 변경은 PR 리뷰 필수.** `app/shared/*`, `app/schemas/common.py`처럼 여러 기능이 의존하는 코드를 수정할 때는 반드시 PR 리뷰를 거친다(파급 효과가 크기 때문).

## 5. 중요 원칙: 계약 불변

- `api.md`(엔드포인트)와 `data-models.md`(데이터 모양)에 정의된 **계약은 이 구조 변경과 무관하게 불변**이다.
- 이번 리팩터링에서 바뀌는 것은 오직 **"구현이 어디 있는지"** 뿐이다. 외부에 노출되는 엔드포인트와 데이터 모델의 형태는 그대로 유지된다.
- 즉, 프런트엔드나 외부 호출자는 이 구조 변경의 영향을 받지 않는다.
