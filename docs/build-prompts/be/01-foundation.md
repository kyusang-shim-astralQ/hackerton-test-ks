# be/01 · 백엔드 파운데이션 (백지 MVP) — FE 파운데이션과 함께 가장 먼저

> 사용법: 모노레포 루트에서 새 Claude Code 세션을 열고 아래 "프롬프트"를 붙여넣으세요. (FE `fe/01-foundation.md`와 병행/순차 무관.)

---

## 프롬프트

너는 모노레포의 **백엔드를 from-scratch로 스캐폴드**한다(reference 코드 없음, MVP). `docs/backend-structure.md`의 package-by-feature 구조를 그대로 따른다.

### 먼저 읽어라
- `docs/backend-structure.md` — 폴더 구조·파일 역할(router/service/schemas)·레이어.
- `docs/contracts/data-models.md` — cross-feature 모델(정확한 필드).
- `docs/build-prompts/MVP-SCOPE.md` — 무엇을 real/stub으로 둘지.

### 만들 것 (`backend/`)
1. **FastAPI 앱** `app/main.py`: CORS(`allow_origins=["*"]`), 라우터 등록(아래 6개 feature router include), `GET /health`. 정적 서빙은 불필요(프런트는 Next 별도).
2. **core**: `app/core/config.py`(env 로드 — `CLAUDE_API_KEY`, `APP_PORT=8000`, **클러스터 `USE_SGE`/`CLUSTER_*`/`CP2K_*`**), `app/core/llm.py`(**Anthropic 클라이언트 래퍼 — 실제**; 최신 Claude, `complete(system, user)` + JSON 파싱 유틸), **`app/core/sge.py`(SSH/SGE 클라이언트 — `paramiko`; `CLUSTER_*` env로 접속, SFTP 업로드/회수, `run.sh` 생성, `qsub`/`qstat`/`qdel` 래퍼. f4가 사용. 자격증명은 config에서만 읽고 로그·응답에 절대 노출 금지)**.
3. **공유 스키마** `app/schemas/common.py`: `data-models.md`의 cross-feature 모델을 Pydantic으로 1:1 정의 — `AtomInfo`, `PlanStep`, `GeneratedFile`, `JobStatus`, `StepHistory` 등(요청 모델 `PlanRequest`/`InpRequest`/`SubmitRequest`/`BenchmarkRequest` 포함). **이게 FE·BE 공유 계약의 코드본이니 필드명·타입을 정확히.**
4. **기능 스캐폴드**: `app/features/{structure,plan,inp,jobs,report,benchmark}/{router.py,service.py,schemas.py}` 빈 골격(엔드포인트 자리만, 내용은 be/02~07이 채움).
5. **경량 공유 유틸**(MVP — 무거운 엔진 대신): `app/shared/inp_template.py`(f3용 CP2K `.inp` 문자열 템플릿 자리), `app/shared/jobs_mock.py`(f4 **폴백용**(`USE_SGE=0`/SSH 실패 시) 인메모리 가짜 job 스트림 자리). `schema_engine`/`physics_rules`(무거운 엔진)는 **만들지 않는다**(MVP 밖). **`self_healing`은 경량으로 f4(be/05)가 구현**(`app/core/llm` + `docs/prompts/healing-prompt.md`; 지식베이스 학습·schema_engine 의존 제외). 실제 SGE 제출은 `app/core/sge.py` SSH.
6. **실행 설정**: `backend/`에서 `uvicorn app.main:app --reload --port 8000`로 기동. `.env.example`에 `CLAUDE_API_KEY=` + 클러스터 변수(`USE_SGE`/`CLUSTER_HOST`/`CLUSTER_PORT`/`CLUSTER_USER`/`CLUSTER_PASSWORD`/`CLUSTER_REMOTE_ROOT`/`CLUSTER_QUEUE`/`CLUSTER_PE`/`CLUSTER_MPI_RANKS`/`CP2K_ROOT`/`CP2K_DATA_DIR`/`CP2K_MPIEXEC`/`CP2K_SETVARS`)를 **키만(값 비움)** 나열. `requirements.txt`(fastapi, uvicorn, anthropic, ase, python-dotenv, pydantic, **paramiko**).

### 검증 / 완료 정의 (DoD)
- [ ] `uvicorn app.main:app --port 8000` 기동, `GET /health` 200, `/docs`(OpenAPI) 노출.
- [ ] `app/schemas/common.py`가 `data-models.md`와 필드 일치.
- [ ] 6개 feature 라우터가 등록되어 빈 엔드포인트라도 `/docs`에 보임.
- [ ] 폴더 구조가 `backend-structure.md`(app/core·schemas·shared·features) 준수.
- [ ] `app/core/llm.py`가 `CLAUDE_API_KEY`로 실제 Anthropic 호출 가능(간단 핑 테스트).
- [ ] `app/core/sge.py`(paramiko SSH/SGE 클라이언트) 스캐폴드 + `config`가 `USE_SGE`/`CLUSTER_*`/`CP2K_*`를 로드(값은 `.env`만 — 하드코딩·로그 노출 금지). `requirements.txt`에 `paramiko` 포함.
