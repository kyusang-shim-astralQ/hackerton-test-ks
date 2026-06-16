# be/05 · f4-jobs 백엔드 (✅ REAL · SSH/SGE) — 실제 Faraday 클러스터 제출

> `be/01-foundation.md` 완료 후 실행. (be/01이 `app/core/sge.py` SSH/SGE 클라이언트와 클러스터 config를 스캐폴드해 둔 상태를 전제.)

---

## 프롬프트

너는 백엔드 **f4-jobs** 기능을 from-scratch로 구현한다(REAL — SSH로 Faraday SGE 클러스터에 **실제 `qsub` 제출·모니터링**). 백엔드는 로컬에서 돌고, **paramiko(SSH/SFTP)로 클러스터에 접속**해 입력파일 업로드 → `qsub` → `qstat` 폴링 → 결과 회수까지 수행한다. 엔드포인트/응답 **계약(api.md·data-models)은 그대로 유지**하고 구현만 실제로 바꾼다. 클러스터가 없거나 `USE_SGE=0`이면 **MOCK 스트림으로 폴백**(데모 안전망).

### 먼저 읽어라
- `docs/features/f4-jobs/api.md` — 4개 엔드포인트 계약(요청/응답 형태 유지).
- `docs/contracts/data-models.md` — `SubmitRequest`/`SubmitJobResponse`/`JobStatus`/`StepHistory`/`MultiMetadata`.
- `docs/build-prompts/MVP-SCOPE.md`(f4 = ✅ REAL · SSH/SGE).
- repo 루트 `CLAUDE.md` §3(클러스터 env)·§8(비밀키 금지).

### 환경변수 (`app/core/config.py`가 로드 — 값 하드코딩 절대 금지, `.env`만)
`USE_SGE`, `CLUSTER_HOST`, `CLUSTER_PORT`, `CLUSTER_USER`, `CLUSTER_PASSWORD`, `CLUSTER_REMOTE_ROOT`, `CLUSTER_QUEUE`, `CLUSTER_PE`, `CLUSTER_MPI_RANKS`, `CP2K_ROOT`, `CP2K_DATA_DIR`, `CP2K_MPIEXEC`, `CP2K_SETVARS`. **코드·로그·응답·문서에 값(특히 `CLUSTER_PASSWORD`)을 절대 출력하지 않는다.**

### 구현 (`backend/app/features/jobs/` — `app/core/sge.py` SSH 클라이언트 사용)
`app/core/sge.py`(be/01 스캐폴드)의 paramiko 기반 클라이언트로 아래를 구현한다.

1. **제출 `POST /submit-job`** → `SubmitJobResponse{status, directory, is_multi, sub_jobs[]}`:
   - 원격 작업 디렉터리 `{CLUSTER_REMOTE_ROOT}/{job_name}` 생성(SFTP `mkdir -p`).
   - 각 step `.inp`(요청 `files` 또는 자동생성)와 **`run.sh`(SGE 배치 스크립트)** 를 SFTP 업로드.
   - SSH `cd {원격dir} && qsub run.sh` 실행 → stdout에서 `job_id` 파싱(`"Your job <id>"`).
   - 즉시 응답 반환, 실제 진행은 백그라운드(BackgroundTask/데몬 스레드).
   - **다중-CIF**(`multi_atom_info` len>1): 구조별 원격 서브디렉터리 + 개별 `qsub` → `is_multi=true`, `sub_jobs[]`(계약의 `{filename, job_key}`).

2. **`run.sh` 템플릿** (`app/core/sge.py`가 env로 렌더):
   ```bash
   #!/bin/bash
   #$ -cwd
   #$ -q {CLUSTER_QUEUE}
   #$ -pe {CLUSTER_PE}
   #$ -N {job_name}
   #$ -o cp2k.out -e cp2k.err
   source {CP2K_SETVARS}
   export CP2K_DATA_DIR={CP2K_DATA_DIR}
   {CP2K_MPIEXEC} -n {CLUSTER_MPI_RANKS} cp2k.psmp -i {step}.inp -o {step}.out
   ```
   (`source {CP2K_SETVARS}` 후 PATH의 `cp2k.psmp` 사용. PATH에 없으면 `{CP2K_ROOT}` 아래 실제 바이너리 경로로.)

3. **모니터링 `GET /job-live-status/{job_key:path}?lang`** → 폴링마다 SSH로:
   - `qstat`로 job 상태 확인(`qw` 대기 / `r` 실행 / 목록에 없음=종료).
   - 원격 `cp2k.out` tail을 읽어 SCF ΔE·총에너지·iter 파싱(정규식 `ENERGY| Total FORCE_EVAL`, SCF 스텝 라인) → `JobStatus`(status/active_step/total_steps/scf_history/energy_history/logs/**`step_histories` 스텝별**/scf_progress) 갱신.
   - qstat에서 사라지고 `cp2k.out`에 종료 표식(`PROGRAM ENDED`/`PROGRAM STOPPED`)이면 → **결과 회수**(SFTP로 `*.out`/`*-pos-1.xyz`/`*.pdos`/`*.bs`를 로컬 `simulations/{job_dir}/`로) 후 `status='all_finished'`. (f5가 이 로컬 산출물을 읽는다.)
   - 다중-CIF면 서브잡별 상태를 집계(`sub_jobs[].status`).

4. **중단 `POST /job-stop`** → SSH `qdel {job_id}` → `status='aborted'` 영속화.

5. **다운로드 `GET /download-job/{job_name}`** → 로컬 `simulations/{job_name}/`(회수된 결과)를 `tar.gz` 스트리밍. 없으면 원격에서 회수 후 압축.

### MOCK 폴백 (데모 안전망 — 끄지 말 것)
`USE_SGE=0`이거나 SSH 연결 실패 시 → `app/shared/jobs_mock.py`의 가짜 SCF 수렴 스트림으로 **동일한 `JobStatus` 형태**를 제공(클러스터 없이도 6단계 흐름 시연). 실제/목 분기는 **한 곳(config `USE_SGE`)** 에서만.

### 안전장치
- 폴링 간격(예: 8초), 단계/잡 타임아웃, SSH 연결 재사용 + 짧은 백오프 재시도. SSH/SGE 예외는 사용자에게 읽을 수 있는 `JobStatus.message`로 노출(대시보드).
- **자격증명은 `config`에서만** 읽고, 어떤 로그/응답/파일에도 출력하지 않는다.

### 완료 정의 (DoD)
- [ ] `USE_SGE=1`에서 `POST /submit-job` → 클러스터에 **실제 `qsub`** 제출, `job_id` 확보(원격 `{CLUSTER_REMOTE_ROOT}/{job}`에 `.inp`/`run.sh` 업로드 확인).
- [ ] `/job-live-status` 폴링이 실제 `qstat` + `cp2k.out` 파싱으로 SCF 수렴·로그·단계 진행을 계약 `JobStatus`(`step_histories` 스텝별)로 노출.
- [ ] 완료 시 결과(`.out` 등)가 로컬 `simulations/{job_dir}/`로 **회수**되어 f5가 읽을 수 있다.
- [ ] `POST /job-stop`이 `qdel`로 실제 작업을 죽이고, `GET /download-job`이 결과 `tar.gz`를 내려준다.
- [ ] 다중-CIF면 구조별 서브잡 N개가 각각 제출·모니터링된다.
- [ ] `USE_SGE=0`/연결 실패 시 MOCK 폴백으로 흐름이 끝까지 동작.
- [ ] **자격증명(`CLUSTER_PASSWORD` 등)이 로그/응답/커밋에 절대 노출되지 않음**(.env만, .gitignore 확인).
- [ ] (통합) 가벼운 1-step ENERGY 계가 제출→완료→상태/결과 회수까지 end-to-end 동작.
