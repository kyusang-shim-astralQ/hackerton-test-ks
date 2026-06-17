# be/05 · f4-jobs 백엔드 (✅ REAL · 원래 로직 재현 — 자가치유 + SSH/SGE)

> `be/01-foundation.md` 완료 후. **reference 코드를 복사하지 않는다.** 아래 알고리즘 명세만 보고 **그대로 재구현**한다. SGE 호출만 `subprocess`가 아니라 `app/core/sge.py`의 SSH(paramiko)로 한다(백엔드 로컬, 클러스터 원격). 데이터 `healing_knowledge.json`은 `app/shared/`에 둔다(없으면 빈 `{}`로 시작).

---

## 프롬프트

너는 백엔드 **f4-jobs**를 구현한다: 제출 → `qstat` 모니터 → **실패 시 자가치유(진단→KB heal→AI heal→재시도≤3)** → 좌표 체이닝 → 완료. 아래 명세대로 **재구현**하라. (`docs/features/f4-jobs/api.md`·`data-models.md` 계약 유지, `docs/prompts/healing-prompt.md` = AI heal 프롬프트.)

### A. `app/shared/physics_rules.py` (재구현)
**`apply_physics_rules(options)` → logs** — dict in-place 교정(키는 대소문자/`&` 무시 매칭):
1. RUN_TYPE이 GEO_OPT/CELL_OPT인데 `FORCE_EVAL/PROPERTIES/TDDFPT`가 있고 `RELAX_STATE`가 없으면 → TDDFPT 삭제(바닥상태 최적화에 불필요, 타임아웃 방지).
2. `DFT/KPOINTS` 있고 `SCF/OT` 있으면 → OT 삭제 + `SCF/DIAGONALIZATION/ALGORITHM STANDARD`(OT는 k-point 불가).
3. `PROPERTIES/TDDFPT` 있고 `DFT/KPOINTS` 있으면 → KPOINTS 삭제(TDDFPT는 Gamma 전용).
4. 주기성 vs Poisson: `SUBSYS/CELL/PERIODIC`가 NONE이면 `DFT/POISSON/{PERIODIC NONE, POISSON_SOLVER MT}`(PSOLVER 제거), 아니면 `POISSON/PERIODIC=<periodic>`.
5. GEO_OPT/CELL_OPT + 주기적이면 `MOTION/<run_type>/{MAX_FORCE 1.5E-3, RMS_FORCE 1.0E-3}`(너무 빡센 값 완화).
6. GEO_OPT/CELL_OPT + 주기적 + 원자수>50이면 OPTIMIZER BFGS→**LBFGS**.

**`apply_scf_repair(options, stage)` → (logs, param_overrides)** — SCF 실패 사다리. **트리 패치 + "거버닝 파라미터 오버라이드(dict)"를 함께 낸다.** 거버닝 파라미터(`scf_algo`/`use_smear`/`max_scf`/`smear_temp`/`added_mos`)는 오케스트레이터가 **`suite_params`에 병합**해야 다음 제출의 `_enforce_physics`가 유지한다(트리에만 넣으면 enforcement가 도로 지움 — 아래 **★ 핵심 규칙** 참고).
- **stage1**: `param_overrides={max_scf: max(현재,100)}` + (OT면) 트리 `SCF/OT/MINIMIZER CG`, `SCF/OUTER_SCF/{MAX_SCF 50, EPS_SCF 1.0E-6}`(OT 하위·OUTER_SCF는 enforcement가 유지).
- **stage2**: `param_overrides={scf_algo: "DIAGONALIZATION", max_scf: 200}` + 트리 `SCF/MIXING/{METHOD BROYDEN_MIXING, ALPHA 0.1}`(이제 DIAG라 MIXING이 살아남음).
- **stage3**: `param_overrides={use_smear: True, smear_temp: 1000, added_mos: 30}`(enforcement가 자동으로 DIAGONALIZATION + SMEAR + ADDED_MOS 유지).
(stage 번호 = `retry_count+1`.)

### B. `app/shared/self_healing.py` — `CP2KHealingEngine` (재구현)
지식베이스 `healing_knowledge.json`(`{signature: {reason, fixes:[경로형줄]}}`)을 로드/저장.

**B-1. `_get_log_signature(log_tail)`**: ABORT 박스(`[ABORT] ... ===== Routine Calling Stack =====` 사이)에서 드로잉 문자/`*`/파일경로 줄 제거해 핵심 에러 추출 → 없으면 `Segmentation fault|KeyError|...|Error termination` 정규식 → 숫자→`N`, 경로→`PATH`로 일반화 후 **md5 해시**. (`UNKNOWN` 해시 `696b03...`는 매칭 금지.)

**B-2. `diagnose(log_tail, lang)` → (diag_id, {signature, extracted}, human_msg)**:
- `MAXIMUM NUMBER OF OPTIMIZATION STEPS`(미수렴) → `("GEO_OPT_NOT_CONVERGED", ..., "구조 최적화 최대 단계 도달")`.
- 성공 키워드(`GEOMETRY OPTIMIZATION COMPLETED`/`ENERGY| Total FORCE_EVAL`/`SCF ... DONE`/`PROGRAM ENDED AT`) 있고 `[ABORT]` 없으면 → `(None, {}, "")`(정상).
- ABORT/런타임 에러 추출 → 한글/영문 스마트 번역(DIMER 중복, Line Search 미지원, BASIS NOT FOUND, UNKNOWN KEYWORD, SCF NOT CONVERGED, XC 중복, INVALID CELL, DISPERSION 등). signature가 지식베이스에 있으면 `KNOWN_ERROR`, 아니면 `CP2K_ABORT`/`RUNTIME_ERROR`.

**B-3. `heal(options, diag_id, match_groups, retry_count)` → (new_options, logs)**: signature가 지식베이스에 있으면 `parse_path_based_options(fix list)`를 `deep_update`로 적용 + "경험 기반 처방" 로그. 없으면 `(options, [])`.

**B-4. `heal_with_ai(options, log_tail, retry_count, job_dir, ai_meta, lang)` → (new_options, logs, msg, param_overrides)**:
- 스마트 캐시: signature가 지식베이스에 있으면 AI 호출 없이 처방 적용 + `validate_and_correct` 후 반환.
- 아니면: 로그 압축(헤더 50 + 마지막 SCF 블록 + 푸터 70줄) → 현재 `.inp` 읽기 → core_error 추출 → 관련 토큰의 `schema_engine.get_manual_snippet`로 `xml_context` → **`docs/prompts/healing-prompt.md` 프롬프트**(system_context/current_inp/core_error/log_tail/history + xml_context)로 `app/core/llm`(Claude) 호출 → `REASON_KR`/`FIX_KR`/`FIX:`(경로형 줄들) 파싱 → **FIX 줄을 분리**: `@PARAM/`로 시작하는 줄은 `param_overrides`(dict)로 모으고, 나머지 일반 경로형 줄만 `parse_path_based_options(fix_lines)` → `deep_update`로 트리에 적용 → `validate_and_correct` → `last_attempt={signature, reason, fixes}` 저장.
- **★ 무처방 시 빈 `msg` 반환(필수)**: AI 호출이 실패(키 없음/네트워크/타임아웃)하거나 적용 가능한 FIX를 못 내면 `(options, [경고로그], "", {})`처럼 **`msg`를 빈 문자열, `param_overrides`를 빈 dict**로 돌려준다. (오케스트레이터는 `msg`/`param_overrides`/트리 변화로 "처방 있음"을 판정하므로, 실패 메시지를 `msg`로 돌리면 그걸 처방으로 오인해 **동일 `.inp`를 재제출**한다 — 이게 자가치유가 도는데 `.inp`가 안 변하는 또 다른 원인이다.)

**B-5. `validate_and_correct(options, mandatory)` → (new_options, logs)**: `schema_engine.validate_and_relocate(options, mandatory)` → 그 결과에 `physics_rules.apply_physics_rules` 적용 → 합친 로그 반환. (be/04 `build_full_inp`이 이걸 **3-pass** 호출.)

**B-6. `record_success()`**: `last_attempt` 있으면 `knowledge[signature]={reason,fixes}` 저장(영구 학습). **B-7. `get_retry_filenames(step_dir, base, n)`** → `{name}_retry_{n}.inp/.sh`.

> ### ★ 핵심 규칙 — 자가치유가 `.inp`를 **실제로** 바꾸게 하기 (이게 빠지면 무한 재시도하는데 `.inp`가 안 변한다)
> **증상**: qsub·진단·치유 로그는 도는데 재시도 `.inp`가 직전과 100% 동일 → 같은 에러 반복 → MAX_RETRIES로 실패.
> **원인**: `_enforce_physics`(be/04 A-4)는 **매 제출마다 `mandatory`(= `suite_params`의 `use_smear`/`scf_algo`/`max_scf`/`eps_scf`/`cutoff`…)로 SCF 알고리즘·SMEAR·파일을 강제**하고 **맨 마지막에** 실행된다. 그래서 **OT일 때 `MIXING`을, `use_smear=False`일 때 `SMEAR`를 무조건 제거**한다. 자가치유가 **옵션 트리에만** `MIXING/SMEAR/ADDED_MOS`를 넣으면 다음 제출에서 enforcement가 도로 지워 `.inp`가 그대로다. (게다가 자가치유는 `step["inp_options"]`만 갱신하고 `suite_params`는 그대로라, 다음 `_submit_step`이 **원래 파라미터로** `mandatory`를 다시 만들어 모든 트리 패치를 덮어쓴다.)
> **해결 (2가지를 모두 해야 함)**:
> 1. **거버닝 파라미터 변경은 반드시 `entry["suite_params"]`(→ `mandatory`)에 반영**한다. SCF 알고리즘/스미어/MAX_SCF/EPS_SCF/charge 등을 바꾸려면 트리가 아니라 `suite_params`를 갱신해야 enforcement가 **유지**한다. 트리에만 넣어도 살아남는 것은 enforcement가 안 건드리는 것들뿐이다 — OT 하위 `MINIMIZER`/`PRECONDITIONER`(enforcement가 `setdefault`라 기존값 우선·생존), `OUTER_SCF`, `MOTION/*`, 그리고 키워드/enum/파일명 교정.
> 2. **`@PARAM/<KEY> <VALUE>` 처방 줄 → `suite_params` 매핑.** KB·AI 처방에서 거버닝 파라미터를 바꾸고 싶으면 `@PARAM/USE_SMEAR true`, `@PARAM/SCF_ALGO DIAGONALIZATION`, `@PARAM/MAX_SCF 200`, `@PARAM/SMEAR_TEMP 1000`, `@PARAM/ADDED_MOS 30` 형식으로 낸다. 처방을 적용할 때(`heal`/`heal_with_ai`/사다리) **`@PARAM/`로 시작하는 줄은 트리에 넣지 말고 `suite_params`에 병합**하고, 나머지 일반 경로형 줄만 `deep_update`로 트리에 넣는다.

### C. `app/features/jobs/service.py` — `CP2KOrchestrator` (재구현, SGE는 SSH로)
모듈 싱글톤 + `threading.RLock`. 상태는 `job_status.json`(원자적 쓰기) + 메모리 dict. job_key = `simulations/` 뒤 경로의 `/`→`_`.

**C-1. `start_job_suite(job_dir, steps, atom_info, **params)`**: `_reindex_active_steps`(selected & not exclude만 1-based 재인덱싱) → `job_status_db[job_key]` 초기화(status Running, total_steps, `step_histories`={str(i+1):{energy,scf,...,run_type}}, `suite_params` 스냅샷) → `_submit_step(1)`.

**C-2. `_submit_step(step_idx, retry_count, **params)`**:
- `step_dir = {job_dir}/step{idx}_{run_type}`. 파일 `step{idx}.inp/.sh/.out`(retry면 `get_retry_filenames`).
- `suite_params.use_smear`면 SMEAR/ADDED_MOS 경로 주입, 아니면 SMEAR 제거. (이 값들은 자가치유가 `suite_params`를 갱신했으면 그 최신값을 쓴다.)
- **3-pass `healing_engine.validate_and_correct`**(mandatory 구성) → `step["inp_options"]` 갱신.
- inp: provided_files 있으면 그대로, 아니면 `build_full_inp(...)`(be/04).
- **★ `mandatory`/`build_full_inp` 인자는 `suite_params` 전체에서 만든다(필수):** `run_type`·`cutoff`·`rel_cutoff`·`functional`·`basis_set`·`method`·`scf_algo`·`charge`·`multiplicity`·`use_smear`·`smear_temp`·`eps_scf`·**`max_scf`**·**`added_mos`**·`lsd`·`ignore_scf_failure`를 **모두** 넘긴다. (특히 `max_scf`·`eps_scf`·`added_mos`를 빠뜨리면 자가치유가 `suite_params.max_scf`/`added_mos`를 올려도 `_enforce_physics`까지 전달되지 않아 `.inp`가 안 바뀐다.) `use_smear`일 때 `ADDED_MOS`는 `suite_params.added_mos`(없으면 20)로 주입.
- run.sh = **아래 SGE_TEMPLATE**. retry면 `-pe 16cpu 16`→`-pe 8cpu 8`로 다운스케일.
- **제출(SSH)**: `app/core/sge.py` `SGEClient`로 원격 `{step_dir}`에 `.inp`/`.sh` SFTP 업로드 → `qsub` → stdout에서 job_id 파싱. (reference의 `subprocess.run(QSUB)` 대체.) → db 업데이트 → `_monitor_and_chain` 스레드.

**C-3. run.sh `SGE_TEMPLATE`** (그대로):
```bash
#!/bin/bash
#$ -N {job_name}
#$ -V
#$ -cwd
#$ -S /bin/bash
#$ -q {CLUSTER_QUEUE}        # 기본 gp3
#$ -pe {CLUSTER_PE}          # "16cpu 16" 통째. 재시도 시 "8cpu 8"
export FI_PROVIDER=tcp
export MKL_DEBUG_CPU_TYPE=5
export CP2K_ROOT={CP2K_ROOT}
export LD_LIBRARY_PATH=$CP2K_ROOT/lib:$LD_LIBRARY_PATH
export OMP_NUM_THREADS=1
export CP2K_DATA_DIR={CP2K_DATA_DIR}
source {CP2K_SETVARS}
ulimit -s unlimited
{CP2K_MPIEXEC} -n {CLUSTER_MPI_RANKS} $CP2K_ROOT/bin/cp2k.psmp -i {inp} > {out} 2>&1
```
> CP2K 빌드에 toolchain 의존성이 있으면 `source $CP2K_ROOT/tools/toolchain/install/setup`도 추가. `CLUSTER_*`/`CP2K_*`는 config(.env)에서. **`-pe`엔 `CLUSTER_PE` 통째, 랭크는 `-n {CLUSTER_MPI_RANKS}`(=8)** — 랭크를 `-pe`에 붙이지 말 것.

**C-4. `_monitor_and_chain(step_idx, job_id, retry_count, ...)`** (데몬 스레드, 10초 폴링):
- **`qstat`(SSH)** 로 job 상태(`qw`/`r`/없음=finished; 등록 지연 유예). aborted면 종료.
- 실행 중이면 원격 `.out`를 읽어(`_parse_live_data`, `PHYSICS_PATTERNS`) `energy_history`/`scf_history`/`step_histories[str(idx)]`/`scf_progress`/`macro_progress`/`current_scf_step` 갱신, TDDFPT면 Davidson 진행 파싱, 새 로그 줄을 정제해 `logs`에 추가.
- **finished면**: `.out` tail(마지막 500줄) → `healing_engine.diagnose(log_tail)`. 루프 종료.
- 루프 후:
  - **diag_id 있으면(실패)** — `retry_count ≥ 3`이면 `🛑 시도 횟수 초과`로 중단. 아니면 **재시도 처방**을 만든다(★ 핵심 규칙: 트리뿐 아니라 `suite_params`도 갱신):
    1. **결정론적 사다리(수렴 실패의 주 경로)** — `SCF_NOT_CONVERGED`/`GEO_OPT_NOT_CONVERGED`/SCF성 `CP2K_ABORT`면 `apply_scf_repair(options, stage=retry_count+1)`를 적용해 `(logs, param_overrides)`를 받고 → **`param_overrides`를 `entry["suite_params"]`에 `deep_update`**, 트리 패치는 `step["inp_options"]`에 반영. (GEO_OPT 미수렴은 `MOTION/<run_type>/{MAX_ITER↑, MAX_FORCE 완화}` 트리 + `param: max_scf↑`.)
    2. **KB heal**: signature가 지식베이스에 있으면 그 처방을 적용(`@PARAM/` 줄은 `suite_params`로, 나머지는 트리로).
    3. **AI heal**: KB 미스인 스키마/키워드 오류(UNKNOWN_KEYWORD/INVALID_ENUM/BASIS_NOT_FOUND 등)면 `heal_with_ai`(Claude, ai_meta=elements/atom_count/cell/property/scf_algo/expert_tip) → 반환된 `param_overrides`는 `suite_params`로, 트리 패치는 `step["inp_options"]`로. **`msg`가 빈 문자열이면 "처방 없음"** 으로 본다.
    → 각 단계는 `healing_history`에 **"무엇을 왜 고쳤는지"** 기록.
  - **★ 변경 검증 게이트 (동일 `.inp` 재제출 방지 — 필수)**: 처방 적용 후 **다음 제출용 `.inp`를 미리 렌더**(`build_full_inp`에 갱신된 `suite_params`/트리 사용)해 **직전 시도의 `.inp` 텍스트와 바이트 비교**한다.
    - **달라졌으면** → `time.sleep(2)` → `_submit_step(retry_count+1)`.
    - **동일하면**(처방이 enforcement에 먹히지 않았거나 무처방) → 재시도를 낭비하지 말고 **사다리 다음 단계로 강제 상향** 후 다시 렌더·비교. 그래도 동일하거나 **같은 signature가 직전과 반복**되면 `🛑 자가 치유 실패 (동일 입력 반복)`로 즉시 중단(CLAUDE.md §5 "같은 에러 반복 시 즉시 중단"). 이 게이트가 "자가치유는 도는데 `.inp`가 안 변하는" 상태를 구조적으로 차단한다.
  - **성공이면**: `retry_count>0`이면 `record_success()`. 다음 활성 스텝 있으면 → **좌표 체이닝**(`_get_updated_atom_info`: GEO_OPT/CELL_OPT/MD면 `*-pos-1.xyz` 마지막 프레임으로 `full_coord_text`, `*-1.cell`로 `cell` 갱신) → `_submit_step(next, 0)`. 없으면 `simulation_completed.flag` + status `all_finished`.

**C-5. `stop_job_suite`**(SSH `qdel` + status aborted), **`get_job_status`**(db 반환 + 파일시스템 기반 완료 상태 자동복원), **`_resume_all_monitoring`**(서버 재시작 시 Running 작업 모니터 재가동, qstat에 없으면 zombie→aborted).

### D. 다중-CIF = 구조별 독립 자가치유 (★ 5개 전부 치유)
`POST /submit-job`에서 `multi_atom_info`(또는 여러 구조)면 **구조마다 `start_job_suite`를 독립 호출**(`job_dir={parent}/{safe_name}`, 각 sub_job) → `multi_metadata.json`/`sub_jobs[]` 기록. **각 구조가 자기 `_monitor_and_chain` 루프를 돌므로**, 5개 CIF 제출 시 5개가 **각각 진단·치유·재시도**한다.

### E. SSH 어댑터 `app/core/sge.py` (be/01)
`SGEClient`(paramiko): SFTP 업로드/회수, `run(cmd)`(exec_command), `qsub`/`qstat`/`qdel` 래퍼. 자격증명은 config만. 원격 작업 디렉터리 `{CLUSTER_REMOTE_ROOT}/...`, 완료 시 `.out` 등 로컬 `simulations/{job_dir}/`로 회수(f5가 읽음).

### MOCK 폴백
`USE_SGE=0`/SSH 실패 시 `app/shared/jobs_mock.py`(가짜 SCF 스트림, 치유 없이 성공). 분기는 `USE_SGE` 한 곳.

### 완료 정의 (DoD)
- [ ] 실패(`.out` `[ABORT]`/미수렴) → `diagnose` → `heal`(KB)/`heal_with_ai`(Claude)로 `.inp` 수정 → 재제출(≤3). `healing_history`/로그 노출. `record_success`로 학습.
- [ ] **★ 자가치유가 `.inp`를 실제로 변경**: 처방이 거버닝 파라미터를 바꾸면 `suite_params`(→`mandatory`)를 갱신해 `_enforce_physics`가 유지함(트리에만 넣어 enforcement에 지워지지 않음). 재시도 `.inp`가 직전과 **바이트 단위로 달라짐**(변경 검증 게이트 통과); 안 바뀌면 사다리 상향/중단.
- [ ] `heal_with_ai`가 **무처방 시 빈 `msg`** 반환(실패 메시지를 처방으로 오인해 동일 `.inp` 재제출하지 않음).
- [ ] **다중-CIF 5개 제출 시 5개 각각 독립 자가치유**(구조별 sub_job 루프).
- [ ] 성공 시 좌표 체이닝(GEO_OPT→다음 스텝 atom_info 갱신), 완료 시 `all_finished`+flag.
- [ ] `physics_rules`/`schema_engine` 검증이 제출 전·치유 후 적용됨(3-pass).
- [ ] SGE 호출이 SSH(paramiko)로, run.sh가 `SGE_TEMPLATE`(`-pe 16cpu 16` + `-n 8`, 재시도 `8cpu 8`)와 동일. 자격증명 비노출.
