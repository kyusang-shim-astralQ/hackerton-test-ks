# be/07 · f6-benchmark 백엔드 (✅ REAL · 12레벨 정확도 벤치마크 — `test/` 공식결과 대비)

> `be/01-foundation.md` 완료 후 실행. **reference 코드를 복사하지 않는다.** 아래 명세 + **`docs/features/f6-benchmark/api.md`(상세 계약·동작 SSOT)** + `docs/contracts/data-models.md`(18 BenchmarkRequest · 19 BenchmarkReport · 20 BenchmarkLevelReport)대로 **재구현**한다. 물리 로직은 직접 짜지 말고 f1/f2/f3/be05의 공유 모듈을 **조립**만 한다. **데이터 `backend/test/level1~12/`(공식 CIF·INP·calculation.out)는 반입**(repo에 포함).

---

## 프롬프트

너는 백엔드 **f6-benchmark**를 구현한다. 핵심은 **`backend/test/level{N}/`의 공식 CIF/INP를 진실값(ground truth)으로 삼아, 각 레벨에서 [CIF 분석 → AI 플랜 → INP 빌드 → SGE(SSH) 제출 → 자가치유≤3 → 공식 결과 대비 에너지/물성 오차 비교]를 12단계로 자동 수행**하고 실시간 진행/정확도 리포트를 내는 것이다. "에이전트가 만든 입력이 공식 CP2K 결과를 재현한다"가 데모 포인트다.

### 데이터 파일 (반입)
- `backend/test/level{N}/`(N=1..12). 각 레벨:
  - `L{N}_Official.cif` — 구조(에이전트가 읽는 입력).
  - `L{N}_Official.inp` — 공식 입력 = **물리 파라미터 진실값**(여기서 run_type/functional/cutoff/scf_algo 등 추출).
  - `calculation.out` — 공식 결과 = **비교 기준**(`ENERGY| Total FORCE_EVAL` + `PROGRAM ENDED` 보유; 12레벨 전부 존재).
  - 그 외 참조 파일(`.wfn`/`.xyz`/`.psf`/`.pot` 등) — 일부 입력이 외부 참조하므로 제출 디렉토리로 **통째 복사**해 둔다.

### A. `app/features/benchmark/service.py` — `BenchmarkManager` (전역 싱글톤 `benchmark_manager`)
- 상태 `results = {status:"Idle", current_level:0, total_levels:12, reports:[12슬롯], logs:[], logs_pos:0}`. **`asyncio.Lock`**으로 중복 실행 차단.
- 경로: `test_dir = _BACKEND_DIR/test`, 산출물 `_BACKEND_DIR/simulations/benchmark_{YYYYmmdd_HHMMSS}/level{N}/`. (`_BACKEND_DIR`는 be/05 orchestrator와 **동일 패턴** — `features/benchmark` → `app` → `backend`. 타임스탬프는 `datetime.now().strftime`.)
- `LEVEL_TO_PROPERTY = {1:"geo_opt", 2:"energy", 3:"dos", 4:"band", 5:"aimd", 6:"vibrational", 7:"neb", 8:"adsorption", 9:"absorption", 10:"emission", 11:"work_function", 12:"hirshfeld"}` (data-models 매핑과 1:1).

### B. `parse_official_inp_to_dict(content) → dict` (공식 .inp 파서)
스택 기반 라인 파서로 공식 입력을 경로형 dict로 변환:
- 주석(`!`/`#`) 제거. `@SET VAR VAL` 변수 수집 후 텍스트의 `${VAR}`/`$VAR` 치환.
- `&SECTION [params]` → 스택 push, `&END` → pop. **`&NAME VALUE`는 섹션 내 `SECTION_PARAMETERS VALUE`로 규격화**(중복 섹션 방지). `KIND X`는 이름을 `KIND X`로 합침. 같은 경로 중복 섹션은 `_DUPL_{n}` 접미사. 빈 섹션도 존재 표시로 `.../_EXIST TRUE` 경로 추가.
- **COORD 섹션 내부의 `Element x y z`(뒤 3토큰이 float)는 키워드로 취급하지 말고 스킵**(좌표가 다른 섹션으로 번지는 것 방지).
- 누적 경로 리스트 → `app/shared/options.py`의 `parse_path_based_options`로 dict화.

### C. 추출기 (자체 비교 로직 — 자급자족)
- **`_extract_energy(out_path, level=None) → float|None`**: `ENERGY|\s+Total\s+FORCE_EVAL\s+\(\s+QS\s+\)\s+energy\s+\[(eV|hartree|Ha|a\.u\.)\]\s+(값)` 정규식(대소문자 무시). **eV면 `/27.211386`로 Ha 통일.** 백업 패턴(`Total Energy ::`, `Total energy:` 등). **마지막 매치를 최종값**. (level 6은 메인에 에너지 없으면 `-r-0.out` 레플리카 폴백.)
- **`_extract_official_params(level_dir) → dict`**: 디렉토리의 `*Official*.inp`(우선) 또는 첫 `.inp`를 `parse_official_inp_to_dict`로 전체 dict화 → `custom_options`로 보관. 헬퍼로 `run_type`/`global_method`/`qs_method`/`method`/`cutoff`/`rel_cutoff`/`functional`/`scf_algo`/`eps_scf`/`max_scf`/`periodic`/`basis_file`/`pot_file`/`basis_set`(KIND 탐색) 추출(없으면 기본값·타입 강제).
- **`_extract_target_property(out_path, level) → {value, label}`**: 레벨별 물성 — **6** 진동수(`VIB|Frequency (cm^-1)` 등, label `Frequency (cm^-1)`), **3/4/9/10** 갭/여기에너지(TDDFPT `Excitation energy`/`Singlet`, 아니면 `HOMO-LUMO gap`, label eV/Ha), **7** NEB 장벽(`.ener` 마지막행 이미지에너지 `max-min`, 폴백 `.out`의 `ENERGIES [au]` 블록, label `Barrier (Ha)`), **11** Fermi(`Fermi Energy [eV]`, label `Fermi (eV)`), **12** net charge(Hirshfeld 표의 1번 O 원자 행, label `Net Charge`). 그 외는 에너지.

### D. `run_benchmark(req)` — 12레벨 루프 (핵심)
락 획득 → `results` 초기화(12개 `Pending` 슬롯 + 시작 로그) → `simulations/benchmark_{ts}/` 생성. `req.custom_options`가 list면 dict로 방어 변환. 대상 레벨 = `req.levels`(있으면) 또는 `range(1,13)`. 각 레벨:
1. `reports[level-1].status="Running"`, `current_level=level`, 로그 헤더.
2. `cif_path = test/level{N}/L{N}_Official.cif`. **없으면 `Skipped` + continue.**
3. `analyze_cif_structure(cif_bytes, "L{N}_Official.cif")`(f1) → `atom_info`.
4. `official_params = _extract_official_params(level_dir)`. `target_property = LEVEL_TO_PROPERTY[level]`.
5. **PlanRequest 구성**: `atom_info`, `property=target_property`, **공식 추출값 우선**(basis_set/cutoff/rel_cutoff/functional/scf_algo/periodic/eps_scf/max_scf/basis_file/pot_file/method, 없으면 req값), `custom_options = {**req.custom_options, **공식 inp dict, "MOTION":{"GEO_OPT":{"OPTIMIZER":official.optimizer or "BFGS","MAX_ITER":official.max_iter or 1}, "MD":{"STEPS":5,"TIMESTEP":0.5}}}`. `core_hint = {run_type, special_sections, functional, basis_set, cutoff, rel_cutoff, method, periodic, scf_algo, eps_scf, max_scf, motion_params}`. **`plan_req.property` 합성(verbatim)**: `f"{target_property} (Reference Hint: {json.dumps(core_hint)}) {consolidation_hint}"`, 여기서 `consolidation_hint = "\nIMPORTANT: Consolidate all parameters into 2-3 comprehensive steps. DO NOT split every keyword into a separate step."`. (Level 3은 공식 inp에 MIXING 없으면 `FORCE_EVAL/DFT/SCF/MIXING {METHOD BROYDEN_MIXING, ALPHA 0.1, BETA 0.1, NBUFFER 8}` 안전 기본 주입.)
6. `plan_result = await generate_plan_logic(plan_req)`(f2) → `steps`. 모든 step(exclude 제외)의 `inp_options`(list면 `parse_path_based_options`)를 `deep_merge`로 통합 → 가상 `final_step`. 통합 옵션이 비면 그 레벨 `FAILURE`.
7. `job_dir = simulations/benchmark_{ts}/level{N}`. **`test/level{N}/`의 모든 파일/폴더를 job_dir로 복사**(외부 참조 확보) 후, 복사본 중 기존 `.out`/`.o*`/`.log`/`calculation.out`는 **제거(정제)**(폴링 오작동 방지).
8. **공식 inp dict(base) + AI 통합옵션(overlay)** `deep_merge` → `mandatory`(`force_sync=True`, run_type/cutoff/rel_cutoff/functional/basis_set/scf_algo/method/atom_info/basis_file/pot_file…) 구성 → `healing_engine.validate_and_correct(initial_options, mandatory)` → `build_full_inp(final_checked_options, atom_info, step_idx=1, all_steps=[final_step], run_type, force_sync=True, …공식/플랜 파라미터…, prop=target_property)`(f3) → `job_dir/calculation.inp` 기록(fsync). `run.sh` = **be/05 `SGE_TEMPLATE`**를 `SGE_TEMPLATE.format(job_name=f"bench_L{level}", inp_filename="calculation.inp", out_filename="calculation.out")`로 렌더(★ **인자명은 반드시 `job_name`/`inp_filename`/`out_filename`** — be/05 템플릿 placeholder와 일치해야 함; `{inp}`/`{out}` 등 다른 이름이면 `KeyError`로 빌드가 깨진다).
9. **제출·폴링·자가치유** = 아래 **E**(SSH/SGE). 실패 진단 → `diagnose` → `heal_with_ai`(ai_meta에 `mode:"BENCHMARK"`, `property`, `force_sync:True`) → KB `heal` 백업 → 재빌드(`build_full_inp`) → 재제출(`level{N}_retry_{n}/`, **≤3**). 성공 시 `record_success()`. `healing_count`/`last_diag` 갱신.
10. **비교**: agent `out_path`(job_dir/calculation.out) vs `official_out`(`test/level{N}/calculation.out`). `level ∈ {3,4,6,7,11,12}`면 `_extract_target_property` 우선, 양쪽 값 있으면 그 물성으로 비교, 아니면 `_extract_energy`(label `Energy (Ha)`). `diff_rel = |agent-official| / max(|official|,1e-12) * 100`. **판정**: `diff_rel < 1.0` **또는** (에너지 비교 시 agent가 더 낮음=더 안정적)이면 `SUCCESS`, 계산은 끝났으나 그 외면 `INCORRECT`, 추출 실패/타임아웃/예외면 `FAILURE`. `message = "[{label}] Error: {diff_rel:.4f}% (Healed Nx via {diag})"`.
11. `results["reports"][level-1]` 갱신(`agent_energy`/`official_energy`/`diff`/`status`/`message`/`healing_count`).

`finally`: `results["status"]="Finished"`(치명 예외 포함). (api.md "현 구현 주의": 치명 실패는 보존하도록 finally 분기 권장.)

### E. 제출 = SSH/SGE (★ f4와 동일 경로 — `subprocess` 아님)
> reference는 `subprocess.run(["qsub"])` + 로컬 `cp2k.popt`였지만, **우리 시스템은 백엔드 로컬·클러스터 원격**이므로 be/05의 `app/core/sge.py` `SGEClient`(paramiko)로 통일한다.
- `SGEClient`로 원격 `{CLUSTER_REMOTE_ROOT}/benchmark_{ts}/level{N}/`에 `calculation.inp`+`run.sh` SFTP 업로드 → `qsub` → job_id 파싱 → `qstat` 폴링(등록 지연 유예 + `calculation.out`의 `PROGRAM ENDED`/`ABORT`/`Segmentation`/`error` 감지) → 완료 시 `calculation.out`(및 `.ener`/`.pdos`/`.hirshfeld` 등 물성 파일) 로컬 `job_dir`로 회수. 폴링 타임아웃은 레벨당 충분히(예: 5초×수백회). 자격증명은 config만, 로그 비노출.
- run.sh는 be/05 `SGE_TEMPLATE` 그대로(`-pe {CLUSTER_PE}` 통째, `mpiexec -n {CLUSTER_MPI_RANKS}`; inp/out만 calculation.inp/out).

### MOCK 폴백 (USE_SGE=0 / SSH 실패 — 클러스터 없이 시연)
에이전트 inp는 **실제로 생성**(AI 플랜→스키마 빌드 시연)하되, 실행은 불가하므로 **공식 `calculation.out`을 에이전트 결과로 사용**해 비교(diff≈0% → `SUCCESS`)하고 흐름을 끝까지 시연한다. 로그에 "목 폴백(공식 결과 사용)"임을 명시한다. (프런트 `NEXT_PUBLIC_MOCK=1`이면 프런트가 자체 가짜 스트림을 그림 — fe/07.)

### F. `app/features/benchmark/router.py`
- `POST /api/benchmark/run`(`BenchmarkRequest`): `results["status"]=="Running"`이면 거절(`{status:"error", message:"이미 진행 중"}`, HTTP 200), 아니면 `results["status"]="Running"` 점유 → `background_tasks.add_task(benchmark_manager.run_benchmark, req)` → `{status:"success", message:"벤치마크 루프가 기동되었습니다."}`.
- `GET /api/benchmark/status`: `benchmark_manager.results` 직렬화(프런트 2~3초 폴링).

### 완료 정의 (DoD)
- [ ] `backend/test/level1~12`의 공식 데이터로 각 레벨 **[CIF분석→AI플랜→INP빌드→SSH/SGE제출→자가치유≤3→공식 대비 비교]** 전 구간 실수행(가짜 진행 아님).
- [ ] `POST /api/benchmark/run` 중복 거절(`status:"error"`), `GET /api/benchmark/status`가 `BenchmarkReport`(항상 12슬롯) 반환. `levels` 부분/전체 순회.
- [ ] 비교 판정이 명세대로: 오차율<1.0% **또는** 더 낮은 에너지면 `SUCCESS`, 그 외 성공은 `INCORRECT`, 추출/타임아웃/예외는 `FAILURE`. `message`에 라벨·오차율·치유횟수.
- [ ] 제출이 **SSH/SGE(`app/core/sge.py`)** 로(f4와 일관, `subprocess` 아님). `USE_SGE=0`이면 공식결과 폴백으로 흐름 시연.
- [ ] `L{N}_Official.cif` 부재 레벨은 `Skipped`, 루프 계속. 종료 시 `status="Finished"`.
