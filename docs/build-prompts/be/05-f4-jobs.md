# be/05 · f4-jobs 백엔드 (✅ REAL · reference 로직 **그대로** 재현 — 자가치유 + SSH/SGE)

> `be/01-foundation.md` 완료 후. **reference 코드를 복사하지 않되, 아래 알고리즘·상수·정규식·템플릿을 reference와 100% 동일하게 재구현**한다. 유일한 의도적 차이: SGE 호출을 `subprocess`가 아니라 `app/core/sge.py`의 SSH(paramiko)로 한다(백엔드 로컬, 클러스터 원격). **그 외 run.sh 내용·qsub/qstat 파싱·자가치유 흐름·진단/처방은 reference와 byte 단위로 같게** 만든다. 데이터 `healing_knowledge.json`은 `app/shared/`(없으면 `{}`).
>
> ⚠️ **이전 버전 폐기 사항(절대 다시 넣지 말 것)**: `@PARAM/`·`param_overrides`·"변경 검증(byte-compare) 게이트"·`heal_with_ai` 4-튜플·`apply_scf_repair`를 자가치유 주 경로로 호출 — 이것들은 **reference에 없는 가공물**이고 빌드를 깨뜨렸다. 자가치유는 **KB heal → (조건부) AI heal** 두 단계뿐이며 `heal_with_ai`는 **3-튜플**이다.

---

## 프롬프트

너는 백엔드 **f4-jobs**를 구현한다: 제출 → `qstat` 모니터 → **실패 시 자가치유(diagnose → KB `heal` → 조건부 AI `heal_with_ai` → 재시도≤3)** → 좌표 체이닝 → 완료. 아래 명세를 reference와 동일하게 재구현하라. (`docs/features/f4-jobs/api.md`·`data-models.md` 계약 유지, `docs/prompts/healing-prompt.md` = AI heal 프롬프트 원문.)

---

### A. `app/shared/physics_rules.py` (재구현)

**`apply_physics_rules(options) → logs`** — dict in-place 교정. 키 매칭은 대소문자/`&` 무시(`get_norm_key`). reference 규칙 순서 그대로:
1. **RUN_TYPE이 GEO_OPT/CELL_OPT**인데 `FORCE_EVAL/PROPERTIES/TDDFPT`가 있고 그 안에 `RELAX_STATE`가 없으면 → TDDFPT 삭제. 삭제 후 `PROPERTIES`가 비면 `PROPERTIES`도 삭제.
2. `DFT/KPOINTS` 있고 `SCF/OT` 있으면 → OT 삭제 + `SCF/DIAGONALIZATION/ALGORITHM STANDARD`.
3. `PROPERTIES/TDDFPT` 있고 `DFT/KPOINTS` 있으면 → KPOINTS 삭제(TDDFPT Gamma 전용).
4. **주기성↔Poisson 동기화**: `SUBSYS/CELL/PERIODIC`가 `NONE`이면 `DFT/POISSON/{PERIODIC NONE, POISSON_SOLVER MT}` + `PSOLVER` 키 제거. 아니면 `DFT/POISSON/PERIODIC = <periodic>` 설정 + **`PSOLVER`·`POISSON_SOLVER` 둘 다 제거**.
5. **GEO_OPT/CELL_OPT + periodic≠NONE**: `MOTION/<run_type>`의 `MAX_FORCE`/`RMS_FORCE`가 **없거나 `< 0.001`일 때만** `MAX_FORCE = "1.5E-3"`, `RMS_FORCE = "1.0E-3"`로 완화(이미 느슨하면 건드리지 않음).
6. **GEO_OPT/CELL_OPT + periodic≠NONE + 원자수>50**: `MOTION/<run_type>/OPTIMIZER`를 BFGS→**LBFGS**. 원자수는 **COORD 섹션**에서 센다(`@children` 줄 수 / COORD dict / `^\s*[A-Za-z]+\s+[-\d]` 정규식). 기본 OPTIMIZER는 BFGS로 가정.

> 전체를 `try/except`로 감싸 예외 시 로그만 남기고 통과(reference 동일).

**`apply_scf_repair(options, stage) → logs`** (★ reference에는 **정의돼 있으나 orchestrator 자가치유 경로에서 호출되지 않는다** — 충실 재현을 위해 함수는 그대로 두되, §C-4 healing 흐름은 절대 이걸 부르지 않는다(KB→AI heal만)). 반환은 **logs 리스트만**(튜플 아님, `param_overrides` 없음). `FORCE_EVAL/DFT/SCF`를 `setdefault`로 내려가며 **누적 적용**(stage≥N 모두):
- **stage ≥ 1**: `scf["MAX_SCF"] = 100`. 로그 "Increased MAX_SCF to 100".
- **stage ≥ 2**: `scf/OT/{MINIMIZER DIIS, PRECONDITIONER FULL_ALL}`, `DIAGONALIZATION` 있으면 삭제. 로그 "Enabled OT with DIIS/FULL_ALL".
- **stage ≥ 3**: `OT` 삭제, `scf/DIAGONALIZATION/{ALGORITHM STANDARD}`, `dft/MIXING/{METHOD BROYDEN_MIXING, ALPHA 0.1}`. 로그 "Switched to Diagonalization with Broyden Mixing (Alpha 0.1)".
- **stage ≥ 4**: `scf/SMEAR/{METHOD FERMI_DIRAC, ELECTRONIC_TEMPERATURE 300}`, `ADDED_MOS` 없으면 `scf["ADDED_MOS"] = 20`. 로그 "Enabled Fermi-Dirac Smearing (300K) with ADDED_MOS".

> 값은 reference 그대로: 스미어 온도 **300**, ADDED_MOS **20**, OT minimizer **DIIS**. (절대 1000/30/CG로 바꾸지 말 것 — 그건 폐기된 가공물.)

---

### B. `app/shared/self_healing.py` — `CP2KHealingEngine` (재구현)
지식베이스 `healing_knowledge.json`(`{signature: {reason, fixes:[경로형줄]}}`) 로드/저장. `_deep_update`는 `schema_engine._deep_update` 위임. UNKNOWN 시그니처 상수 = `md5("UNKNOWN")` = **`696b031073e74bf2cb98e5ef201d4aa3`**.

**B-1. `_get_log_signature(log_tail) → md5 hex`** (먼저 `_extract_clean_abort`로 핵심 에러 추출):
- ABORT 박스 1차 정규식(verbatim): `re.search(r"\[ABORT\](.*?)(?=\n\s*={5,}|\n\s*===== Routine Calling Stack =====|\Z)", log_tail, re.DOTALL)`.
- 2차(폴백) 정규식: `re.search(r"\*+ \[ABORT\] \*+\s*(.*?)\s*\*+", log_tail, re.DOTALL)`.
- 박스 안 줄별 정리: 앞뒤 `*` strip; 드로잉 문자 제거 정규식 `^\\___/\s*`, `^\|\s*`, `^O/\|\s*`, `^/\|\s*\|\s*`, `^/\s*\\\s*`; `*****`/`___`로 시작하는 줄 버림; **`'/' in line and '.F:' in line` 인 줄(파일:라인 정보) 버림**.
- ABORT 없으면 런타임 정규식: `re.search(r"((?:Segmentation fault|KeyError|File not found|Error reading|invalid|Fortran runtime error|runtime error|Error termination).*)$", log_tail, re.MULTILINE|re.IGNORECASE)`; 그것도 없으면 `error_msg = "UNKNOWN"`.
- 일반화 후 해시(verbatim): `clean = re.sub(r'\d+\.?\d*(?:[Ee][-+]?\d+)?', 'N', error_msg)` → `clean = re.sub(r'/[^ ]+', 'PATH', clean)` → `clean = " ".join(clean.split()).upper()` → `hashlib.md5(clean.encode()).hexdigest()`.

**B-2. `diagnose(log_tail, lang) → (diag_id, {signature, extracted}, human_msg)`** — 순서대로:
1. **GEO_OPT 미수렴 먼저**: `"MAXIMUM NUMBER OF OPTIMIZATION STEPS" in log_tail` **또는** `"MAXIMUM NUMBER OF GEO_OPT STEPS" in log_tail` → `("GEO_OPT_NOT_CONVERGED", {signature: sig("MAXIMUM NUMBER OF OPTIMIZATION STEPS REACHED"), extracted: "MAXIMUM NUMBER OF OPTIMIZATION STEPS REACHED"}, msg)`; msg ko `"구조 최적화 최대 단계 도달 (수렴 실패)"` / en `"Maximum optimization steps reached (convergence failed)"`.
2. **성공 마커**(전부 verbatim): `"GEOMETRY OPTIMIZATION COMPLETED"`, `"ENERGY| Total FORCE_EVAL"`, `"SCF WAVEFUNCTION OPTIMIZATION  DONE"`(DONE 앞 **공백 2칸**), `"VIBRATIONAL FREQUENCIES"`, `"PROGRAM ENDED AT"`. 이 중 하나라도 있고 `"[ABORT]"`가 없으면 → `(None, {}, "")`(정상, 치유 안 함).
3. ABORT 추출되면 `error_msg="CP2K_ABORT"`, 아니면 런타임 정규식(B-1과 동일) → `"RUNTIME_ERROR"`, 둘 다 아니면 `"UNKNOWN_ERROR"`.
4. **스마트 번역**(target = `human_reason.upper()` 부분일치, 첫 매치): 아래 표 그대로. `final_msg = f"{translated_desc} ({human_reason})"`.

| target_text 포함 | ko | en |
|---|---|---|
| `DIMER SHOULD NOT REPEAT` | DIMER 섹션 중복 정의 | Duplicate definition of DIMER section |
| `LINE SEARCH TYPE NOT YET IMPLEMENTED` | 지원하지 않는 Line Search 방식 | Unsupported Line Search type |
| `BASIS` **AND** `NOT FOUND` | 기저집합 파일 유실 또는 오매칭 | Basis set file missing or mismatched |
| `UNKNOWN KEYWORD` **OR** `UNKNOWN SUBSECTION` | 잘못된 키워드/섹션 사용 | Incorrect keyword or subsection |
| `SCF` **AND** `NOT CONVERGED` | SCF 수렴 실패 | SCF convergence failed |
| `SECTION XC SHOULD NOT REPEAT` | XC Functional 중복 정의 | Duplicate definition of XC Functional |
| `INVALID SET OF CELL VECTORS` | 잘못된 격자 벡터(Cell Vector) 지정 | Invalid cell vector specification |
| `REFERENCE_FUNCTIONAL` **OR** `DISPERSION` **OR** `GRIMME` | D3 분산 보정 REFERENCE_FUNCTIONAL 미지정 오류 | D3 dispersion correction REFERENCE_FUNCTIONAL missing |

5. **diag_id 선택**: `sig = _get_log_signature(log_tail)`. `sig`가 KB에 있고 `sig != 696b03...` → `"KNOWN_ERROR"`(KB reason을 메시지에 덧붙이되, reason이 80자 초과면 첫 문장만, 그래도 80 초과면 `[:77]+"..."`). 아니면 위 `error_msg`(`CP2K_ABORT`/`RUNTIME_ERROR`/`UNKNOWN_ERROR`) 반환. `human_reason` 기본값 ko `"원인을 분석 중입니다..."` / en `"Analyzing the root cause..."`.

**B-3. `heal(options, diag_id, match_groups, retry_count=0, lang) → (new_options, logs)`**:
- `sig = match_groups.get("signature")`. `if sig and sig in knowledge and sig != 696b03...:` → `fix_dict = parse_path_based_options(knowledge[sig]["fixes"])` → `_deep_update(options, fix_dict)` → 로그 `[f"경험 기반 처방 적용: {knowledge[sig].get('reason','검증된 해결책')}"]` → `(options, logs)`. 아니면 `(options, [])`. (★ `@PARAM/` 분리 **없음** — fixes를 통째로 트리에 병합.)

**B-4. `heal_with_ai(options, log_tail, retry_count=0, previous_fixes=None, job_dir=None, failure_history=None, ai_meta=None, lang) → (new_options, logs, msg)` (3-튜플)**:
1. **스마트 캐시**: `sig = _get_log_signature(log_tail)`; `if sig in knowledge:`(여기엔 ghost-guard 없음, reference 그대로) KB fix 적용 → `validate_and_correct(options, mandatory_params={"atom_info": ai_meta, **ai_meta})` → `(sanitized, [desc], detail)` 반환.
2. `if failure_history and not previous_fixes: previous_fixes = failure_history`.
3. **로그 압축**(`_compress_log`): `len(lines) > 200`일 때만. header=`lines[:50]`, footer=`lines[-70:]`, 마지막 `"SCF WAVEFUNCTION OPTIMIZATION"` 줄부터 **100줄** 발췌. 배너 `--- [LOG HEADER] ---`, `... (intermediate logs omitted) ...`, `--- [LAST SCF CONVERGENCE TABLE] ---`, `--- [ERROR MESSAGE & STACK TRACE] ---`. (reference 특이점: 압축 결과를 만들지만 프롬프트엔 **원본 `log_tail`을 그대로** 넣는다 — 그대로 따른다.)
4. **현재 `.inp` 읽기**: `step1.inp` 우선, 없으면 마지막 `*.inp` 정렬, 없으면 `build_full_inp(options, {"atoms":[]}, step_idx=1)`.
5. **core_error**: `MAXIMUM NUMBER OF (OPTIMIZATION|GEO_OPT) STEPS`면 힘/EPS 임계 관련 고정 문장; `[ABORT]` 있으면 `[ABORT]`로 split 후 `* \ / ---` 안 든 첫 1~2줄.
6. **xml_context**: `relevant_tokens = ["SCF","MIXING","DIAGONALIZATION","OT","QS"]` + `re.findall(r"([A-Z_]{3,})", core_error)` + 값-에러 키워드 → 토큰별 `schema_engine.get_manual_snippet(t)` 합침.
7. **has_kpts**: ai_meta에 `kpoints`/`kpoints_scheme`/`kpoints_active` 있으면 `"YES"` 아니면 `"NO"`.
8. **프롬프트**: `docs/prompts/healing-prompt.md` 원문(영문, `{xml_context}` 포함, `K-POINTS ACTIVE: {has_kpts}` 줄 포함, EXPERT KNOWLEDGE 6항목, FIX 예시는 `&`-경로형) — 그 파일을 그대로 `prompts.py`로 모아 f-string 채움(placeholders: system_context/has_kpts/current_inp/xml_context/core_error/log_tail/history_msg).
9. **호출**: `app/core/llm`(Anthropic). max_tokens=**1000**, 구조화 출력. 모델 id·파라미터는 `claude-api` 스킬 확인(코드에 박지 말 것).
10. **응답 파싱**(verbatim 정규식):
    - `reason_kr = re.search(r"REASON_KR:\s*(.*)", text).group(1) if "REASON_KR:" in text else "분석 중..."`
    - `fix_kr = re.search(r"FIX_KR:\s*(.*)", text).group(1) if "FIX_KR:" in text else "수정 중..."`
    - `reason_en = re.search(r"REASON:\s*(.*)", text).group(1) if "REASON:" in text else "AI Analysis"`
    - `fix_part = text.split("FIX:")[1] if "FIX:" in text else text`
    - `fix_lines = [l.strip() for l in fix_part.splitlines() if '/' in l and len(l.split()) >= 2]`
11. **적용**: `fix_lines` 있으면 `last_attempt = {"signature": sig, "reason": reason_en, "fixes": fix_lines}` → `_deep_update(options, parse_path_based_options(fix_lines))` → `validate_and_correct(options, {"atom_info": ai_meta, **ai_meta})` → `(sanitized, [처방로그], 처방msg)`.
12. **실패/무FIX**: 예외 또는 `fix_lines` 없음 → `(options, [fail_msg], fail_msg)` — **`msg`는 실패 문자열**(ko `"AI 분석 실패"`/en `"AI analysis failed"`). ★ reference 그대로 — 빈 문자열로 바꾸지 말 것.

**B-5. `validate_and_correct(options, mandatory_params) → (new_options, logs)`**: `schema_engine.validate_and_relocate(options, mandatory_params)` → 결과에 `physics_rules.apply_physics_rules(new_options)` → 로그 병합(physics_logs 있으면 합치고, 둘 다 없으면 `["✅ [Integrity] 수정 불필요 (무결함)"]`). **단일 패스**(3-pass 루프는 §C-2 `_submit_step` 안에서 돈다, build_full_inp 아님).

**B-6. `record_success()`**: `last_attempt` 있으면 `knowledge[last_attempt["signature"]] = {"reason": last_attempt["reason"], "fixes": last_attempt["fixes"]}` → `_save_knowledge()`(JSON 저장) → `delattr(self,'last_attempt')`.

**B-7. `get_retry_filenames(step_dir, base_inp, retry_count) → (step_dir, "{name}_retry_{n}.inp", "{name}_retry_{n}.sh")`** (`name = base_inp.replace(".inp","")`). out 파일명 `{name}_retry_{n}.out`는 호출부(§C-2)에서 따로 만든다.

> ### 자가치유가 `.inp`에 반영되는 경로(reference 그대로) + 알려진 한계
> 치유된 옵션은 `step["inp_options"] = new_options`로 저장되고, 재시도 시 `_submit_step`이 그 트리로 `build_full_inp`를 다시 돌려 새 `.inp`(`step{idx}_retry_{n}.inp`)를 만든다. 추가로 §C-4의 **메타데이터 동기화**(아래)가 새 트리에서 `scf_algo/max_scf/eps_scf/method`를 뽑아 `step[...]`에 써넣어 다음 `mandatory`에 반영한다.
> **한계(정직하게 명시)**: reference의 `_enforce_physics`(be/04 A-4)는 제출 직전 실행되어 `use_smear=False`면 `SMEAR`를, OT면 `MIXING`을 지운다. 그래서 **SCF 미수렴**을 AI가 `&SMEAR`/`&MIXING` 트리 패치로 고치려 하면 enforcement가 되돌릴 수 있다(키워드/섹션 오류·OT 하위 `MINIMIZER`/`PRECONDITIONER`·`OUTER_SCF`·`MOTION/*` 교정은 살아남음). 이는 reference 자체의 특성이며, 본 명세는 reference를 **그대로** 재현한다. (성능 개선이 필요하면 별도 합의 후 진행 — 임의로 `@PARAM/` 류 가공물을 다시 넣지 말 것.)

---

### C. `app/features/jobs/service.py` — `CP2KOrchestrator` (재구현, SGE는 SSH로)
모듈 싱글톤 + `threading.RLock`. 상태는 `job_status.json`(원자적 쓰기 `.tmp`→`os.replace`, 경로 = 이 모듈 디렉터리) + 메모리 dict. `get_job_key(job_dir)`: `job_dir.split("simulations/")[1].replace("/","_")` 있으면 그것, 없으면 `os.path.basename(job_dir)`.

**C-1. `start_job_suite(job_dir, steps, atom_info, expert_tip=None, provided_files=None, **params)`**: `_reindex_active_steps`(아래) → `job_status_db[job_key]` 초기화(status `"Running"`, total_steps, `step_histories`={str(i+1):{run_type,energy:[],scf:[],...}}, `suite_params` 스냅샷, `expert_tip`) → `_submit_step(..., step_idx=1, retry_count=0, ...)`.
- **`_reindex_active_steps`**: `selected`(기본 True) & not `exclude`인 step만 1-based 재인덱싱. `id()` 기준 index_map을 만들어, 각 step의 `inp_options` **문자열 안의 `stepN` 토큰**을 옛→새 인덱스로 치환하고, `step_name`을 `f"Step {i}: {pure_name}"`로 재작성.

**C-2. `_submit_step(job_dir, steps, atom_info, step_idx, retry_count, **params)`**:
- `run_type = step.get("run_type","ENERGY")`; `step_dir = {job_dir}/step{step_idx}_{run_type}`; `os.makedirs(exist_ok=True)`.
- 파일명: 기본 `inp_filename=f"step{step_idx}.inp"`, `sh_filename=f"step{step_idx}.sh"`, `out_filename=f"step{step_idx}.out"`. **retry_count>0이면** `_,inp_filename,sh_filename = get_retry_filenames(step_dir, f"step{step_idx}.inp", retry_count)`, `out_filename=f"step{step_idx}_retry_{retry_count}.out"`.
- **smear 주입/제거**: `use_smear`면 `FORCE_EVAL/DFT/SCF/SMEAR/METHOD=FERMI_DIRAC`, `.../SMEAR/ELECTRONIC_TEMPERATURE=str(smear_temp)`, `.../ADDED_MOS=20`(없으면), `.../DIAGONALIZATION/ALGORITHM=STANDARD`(SCF_ALGO 미지정 시); 아니면 키에 `"SMEAR"` 든 항목 전부 pop.
- **mandatory 구성**(reference 그대로): 인자 DFT 파라미터 + `step.get(...)`로 채움. 포함: `step_idx`, `run_type`, `cutoff`, `rel_cutoff`, `functional`, `basis_set`, `method`, `scf_algo`, `charge`, `multiplicity`, `eps_scf`(=`step.get("eps_scf", params eps_scf)`), `max_scf`(=`step.get("max_scf")`, 기본 None), `ignore_scf_failure`, `kpoints`, `use_smear`, `smear_temp`, `atom_info`, `custom_options`, **`force_sync = (retry_count == 0)`**, 그리고 대문자 별칭 키(`CUTOFF`/`cutoff` 등) 동시 보유, `PERIODIC = "NONE" if kpoints is None else "XYZ"`(또는 atom_info periodic). (max_scf 기본 None → set_if_missing 무동작; 진행률 분모용 `max_scf=50`/`max_geo=200` 기본은 별도 보관.)
- **3-pass 검증**(★ 여기서 돈다): `final_options = step.get("inp_options")`(list면 parse) → `for _ in range(1,4): final_options, integrity_logs = healing_engine.validate_and_correct(final_options, mandatory)`; `actual_fixes = [l for l in integrity_logs if "✅" not in l]`; 더 이상 fix 없으면 break. → `step["inp_options"] = final_options`.
- **inp 렌더**: `retry_count==0 and provided_files and inp_filename in provided_files`면 그 내용, 아니면 `build_full_inp(final_options, atom_info, step_idx=step_idx, all_steps=[...], run_type=run_type, force_sync=(retry_count==0), cutoff=..., functional=..., basis_set=..., scf_algo=..., use_smear=..., smear_temp=..., eps_scf=..., max_scf=..., ignore_scf_failure=..., kpoints=..., method=..., periodic=...)`(be/04). `{step_dir}/{inp_filename}`에 쓰고 `f.flush()`+`os.fsync()`.
- **run.sh**: `SGE_TEMPLATE.format(job_name=f"S{step_idx}_{run_type[:4]}", inp_filename=inp_filename, out_filename=out_filename)`. **retry_count>0이면** `sge_content = sge_content.replace("-pe 16cpu 16","-pe 8cpu 8")`(랭크 `-n 8`은 그대로 — base가 이미 8). `{step_dir}/{sh_filename}`에 쓰기.
- **제출(SSH)**: `SGEClient`로 원격 step_dir(=`{CLUSTER_REMOTE_ROOT}/{job_key}/step{idx}_{run_type}`)에 `.inp`/`.sh` SFTP 업로드 → **원격 cwd를 그 step_dir로 두고 `qsub {sh_filename}`(basename)** 실행(`#$ -cwd`가 산출물을 그 디렉터리에 둠). 필요시 `SGE_ROOT=/var/lib/gridengine SGE_CELL=Faraday PATH=/usr/lib/gridengine:$PATH`를 원격 명령 앞에 export(혹은 `/usr/lib/gridengine/qsub` 절대경로). job_id 파싱: `m = re.search(r'(\d+)', stdout)` → `m.group(1) if m else stdout.strip()`.
- 제출 실패면 status `f"Submission Failed: {stderr}"`, 예외면 `f"System Error: {e}"`(이 접두사들은 멀티잡 집계가 `startswith`로 본다 — 정확히 지킬 것). 성공 시 db에 `job_id`/`step_start_time=time.time()`/`full_options_cache`/`max_scf`/`max_geo`/`logs_pos=0`/`retry_count` 기록 후 `_monitor_and_chain` 데몬 스레드 시작.

**C-3. run.sh `SGE_TEMPLATE`** — ★ **reference와 동일**(placeholder 3개: `{job_name}`/`{inp_filename}`/`{out_filename}`, 나머지는 .env 값으로 렌더하되 **빈 줄 배치·venv 줄·echo 줄·`cp2k.psmp`까지 그대로**). `{inp}`/`{out}` 같은 다른 이름 쓰지 말 것(벤치마크 be/07이 `inp_filename=`/`out_filename=`로 format하므로 이름이 다르면 `KeyError`):
```bash
#!/bin/bash
#$ -N {job_name}
#$ -V
#$ -cwd
#$ -S /bin/bash
#$ -q {CLUSTER_QUEUE}
#$ -pe {CLUSTER_PE}

export FI_PROVIDER=tcp
export MKL_DEBUG_CPU_TYPE=5
export CP2K_ROOT={CP2K_ROOT}
export LD_LIBRARY_PATH=$CP2K_ROOT/lib:$LD_LIBRARY_PATH
export OMP_NUM_THREADS=1

# 가상환경 활성화 (Faraday venv) — ★ reference에 있던 줄. 빠지면 qsub 잡이 즉시 죽는다.
source {CP2K_VENV}

# 데이터 디렉토리 명시적 설정
export CP2K_DATA_DIR={CP2K_DATA_DIR}

# 라이브러리 및 MPI 환경 로드
source {CP2K_SETVARS}
ulimit -s unlimited

# [EXECUTE] CP2K Simulation
echo "[SYSTEM] Calculation Start: $(date)" >> cp2k_run.log
{CP2K_MPIEXEC} -n {CLUSTER_MPI_RANKS} $CP2K_ROOT/bin/cp2k.psmp -i {inp_filename} > {out_filename} 2>&1

echo "[SYSTEM] Calculation Finished: $(date)" >> cp2k_run.log
```
> **`.env` 값 = reference 그대로 맞춘다(qsub 성공의 핵심):** `CLUSTER_QUEUE=gp3`, `CLUSTER_PE="16cpu 16"`, `CLUSTER_MPI_RANKS=8`, `CP2K_ROOT=/share/cp2k-2026.1_mkl`, **`CP2K_VENV=/DATA/lab07/hglee/cp2k_agent/venv/bin/activate`**(★ 신규 — 반드시 .env에 추가), `CP2K_DATA_DIR=/share/cp2k-2026.1_mkl/data`, `CP2K_SETVARS=/share/intel/oneAPI/setvars.sh`, `CP2K_MPIEXEC=/share/intel/oneAPI/mpi/2021.17/bin/mpiexec`. 바이너리는 **`cp2k.psmp`**. **retry는 `-pe`만 `8cpu 8`로, `-n 8`은 유지**(base가 8). `cp2k_run.log` echo 두 줄·빈 줄도 그대로.

**C-4. `_monitor_and_chain(job_dir, steps, atom_info, step_idx, job_id, retry_count, **params)`** (데몬 스레드):
- `step_dir`, `out_file = {step_dir}/step{idx}{('_retry_'+n) if retry>0 else ''}.out`. `grace_period_count` 초기 0, `last_state="none"`.
- **루프(폴링 10초)**: 매 회 `target_job["status"]=="aborted"`면 break. **`qstat`(SSH)** 실행.
  - qstat returncode≠0 → `state = last_state if last_state != "none" else "qw"`(전 상태 유지, finished로 단정 금지).
  - 파싱: `state_match = re.search(rf"{job_id}\s+\S+\s+\S+\s+\S+\s+(\S+)", stdout)`(job_id + 4컬럼 후 **5번째**가 state). 매치면 `state=group(1)`, `grace_period_count=10`. 미매치면 `if grace_period_count < 6 and not os.path.exists(out_file): state="qw"; grace_period_count+=1`(등록 지연 ~60s 유예) **else** `state="finished"`.
  - `state=="r"`(또는 finished+out 존재) 시 `.out` 읽어 `_parse_live_data`(아래) → 히스토리/진행률/로그 갱신, `_save_db()`. `last_state=state`.
  - `state=="finished"`면: `.out` 등장 대기 `for _ in range(6): if exists break; time.sleep(5)`(최대 30s); 없으면 status `"aborted"` 후 break. 있으면 `log_tail = "".join(readlines()[-500:])`(마지막 500줄) → `diag_id, match_groups, human = healing_engine.diagnose(log_tail, lang)` → break.
  - 루프 끝 `time.sleep(10)`. 예외도 `time.sleep(10)` 후 continue(치명 아님). **전체 모니터에 wall-clock 타임아웃 없음** — 큐 이탈 또는 aborted로만 종료(≤3은 **재시도** 한도이지 모니터 시간 제한 아님).
- **`_parse_live_data`**: `out_text`를 `"SCF WAVEFUNCTION OPTIMIZATION"`로 split해 **마지막 블록만** 파싱. `PHYSICS_PATTERNS["scf_step"]`(정규식 `r"^\s*(\d+)\s+((?:OT|Diag|Broy|DIIS|David|Newton|P_Mix)[a-zA-Z_/.]*(?:\s+[a-zA-Z_/.]+)?)\s+(.+)$"`)로 줄 파싱(오른쪽부터: `nums[-2]`=energy, `nums[-1]`=change, `nums[-3]`=scf step), `total_energy`/`geo_max_grad`도. TDDFPT(`"TDDFPT WAVEFUNCTION OPTIMIZATION"` 감지)면 총 상태수 `r"TDDFPT\|\s+Number\s+of\s+states\s+calculated\s+(\d+)"`, Davidson 진행 `r"^\s*(\d+)\s+([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+(?:[Ee][-+]?\d+)?)\s+(\d+)\s*$"`. 로그는 잡소리 필터 후 append(최근 500줄 cap).
- **루프 후**(with lock; status aborted면 return; `user_lang=target_job.get("lang","ko")`):
  - **diag_id 있으면(실패)** — `max_retries = 3`:
    - `if retry_count < max_retries:`
      1. `old_options = step.get("inp_options", {})`(list면 `parse_path_based_options`).
      2. **KB heal 먼저**: `new_options, heal_logs = healing_engine.heal(old_options, diag_id, match_groups, retry_count=retry_count, lang=user_lang)`. `heal_logs`면 로그 `"[HEALING] 🔧 기존 지식 베이스의 검증된 규칙({diag_id}) 처방을 적용합니다."`.
      3. **AI heal는 조건부**: `if not heal_logs or diag_id == "UNKNOWN_CRASH":` → `ai_meta_data = {elements, atom_count, cell, periodic, mode:"SIMULATION", property, scf_algo, kpoints, kpoints_scheme, active_tokens, expert_tip}` → `new_options, ai_logs, ai_msg = asyncio.run(healing_engine.heal_with_ai(old_options, log_tail, retry_count=retry_count, job_dir=job_dir, ai_meta=ai_meta_data, lang=user_lang))` → `step["inp_options"]=new_options`; `heal_logs.extend(ai_logs)`; `human_msg=f"[AI Fix] {ai_msg}"`; `healing_history`에 추가. (전체 `try/except: pass`.)
      4. `if heal_logs:` → `step["inp_options"]=new_options`; **메타데이터 동기화**(새 트리에서 `scf_algo`/`max_scf`/`eps_scf`/`method`를 뽑아 `step[...]`에 기록); 로그 `"[HEALING] 🔄 처방 옵션을 적용하여 계산을 다시 시도합니다..."`; `time.sleep(2)`; `_submit_step(job_dir, steps, atom_info, step_idx, retry_count+1, <원래 DFT 파라미터 그대로 전달>)`; `return`.
      5. `else:`(heal_logs 없음) → 로그 `"🛑 자가 치유 실패"`; `return`.
    - `else:`(retry_count ≥ 3) → 로그 `"🛑 시도 횟수 초과"`; `return`.
    > ★ reference 그대로: **사다리 호출·byte-compare 게이트·@PARAM·suite_params writeback 없음.** 재제출은 **원래 DFT 파라미터**로 가고(치유는 `step["inp_options"]` 트리 + 메타동기화로만 반영), 같은 에러가 반복되면 retry_count가 3에 도달해 `🛑 시도 횟수 초과`로 끝난다.
  - **성공이면(diag_id None)**: `if retry_count > 0: healing_engine.record_success()`. **다음 활성 스텝**(`next_active_idx`) 있으면 → 좌표 체이닝(아래) → `time.sleep(3)` → `_submit_step(next_active_idx, 0, ...)`. 없으면 `simulation_completed.flag` 쓰고 status `"all_finished"`.

- **좌표 체이닝 `_get_updated_atom_info(step_dir, atom_info, run_type)`**: `GEOMETRY_CHANGING_TYPES = ["GEO_OPT","CELL_OPT","MD","MC","TMC"]`(★ MC/TMC 포함). 아니면 unchanged copy.
  - 좌표: `glob("*-pos-1.xyz")` 중 **mtime 최신**; `n_atoms=int(lines[0])`; `last_frame=lines[-(n_atoms+2):]`; **앞 2줄(count/comment) 버리고** `coord_lines=[l.strip() for l in last_frame[2:] if l.strip()]`; `new_info["full_coord_text"]="\n".join(coord_lines)`.
  - 셀: `glob("*-1.cell")` 중 mtime 최신; 마지막 줄 split, `len>=9`면 컬럼 2-10의 세 격자벡터로 `a=sqrt(ax²+ay²+az²)` 등 **크기 [a,b,c]** 계산(각도는 갱신 안 함). try/except로 감쌈.
  - 갱신된 atom_info를 `suite_params["atom_info"]`에 써넣고 다음 스텝 제출.

**C-5.**
- **`stop_job_suite(job_key)`**: `job_id and job_id != "UNKNOWN"`면 SSH `qdel {job_id}`(실패 무시); status `"aborted"`, message `"사용자에 의해 작업이 강제 종료되었습니다."`; 없는 job_key면 `False`.
- **`get_job_status(job_key)`**: db deepcopy + `job_key` 주입 + **`msg_to_text`**(message/healing_history[]/logs[]의 `{"key":..,"params":..}` dict를 `str(key)`로 평탄화 — 모니터가 dict 메시지를 쓰므로 필수) + step_histories의 `run_type` 보강. status가 `all_finished` 아니고 `suite_params` 있으면 **파일 기반 완료 자동복원**: 마지막 활성 step의 최신 `step{idx}*.out` 마지막 4000바이트 tail에 `"T I M I N G"` **또는** `"PROGRAM STOPPED"` 있으면 → `error_heal.log`에 `"HEALING FAILED"`/`"MAX RETRIES EXCEEDED"` 있으면 status `"Failed"`, 아니면 `simulation_completed.flag` 쓰고 `"all_finished"`. (실패 시 `error_heal.log` 기록은 `_fail` 경로에서 남길 것 — 없으면 이 복원이 실패를 못 잡는다.)
- **`_resume_all_monitoring()`**: 서버 기동 후 `time.sleep(3)` → SSH `qstat` → `active_q_ids = re.findall(r"(\d+)\s+", stdout)`. Running 잡 중 `job_id not in active_q_ids`면 zombie → status `"aborted"`(message "서버 재시작 시 큐에서 발견되지 않아 중단 처리되었습니다."), 있으면 `suite_params` 스냅샷으로 `_monitor_and_chain` 재가동. 이동된 워크스페이스 경로 정규화 포함.

---

### D. 다중-CIF = 구조별 독립 자가치유 (★ N개 전부 치유)
`POST /submit-job`에서 `multi_atom_info`(또는 여러 구조)면 **구조마다 `start_job_suite`를 독립 호출**(`job_dir={parent}/{safe_name}`) → `multi_metadata.json`/`sub_jobs[]` 기록. 각 구조가 자기 `_monitor_and_chain` 루프를 도므로 N개가 각각 진단·치유·재시도한다.
- **구조별 kpoints 폴백 체인**(reference): `kpoints = struct.get("kpoints") or struct.get("verified_optimal_kpoint") or struct.get("initial_guess_kpoint") or req.kpoints`. `use_smear`/`smear_temp`도 `struct.get(...) if key in struct else req.*`.
- **광학 물성 Gamma 강제**(reference, 제출 시점): `OPTICAL_PROPS = ["absorption","emission"]`; `req.property in OPTICAL_PROPS`면 단일/다중 분기 **전에** `kpoints = None`(Gamma 강제).

### E. SSH 어댑터 `app/core/sge.py` (be/01)
`SGEClient`(paramiko): SFTP 업로드/회수, `run(cmd)`(exec_command, **원격 cwd 지정 가능** — `cd {dir} && {cmd}`), `qsub`/`qstat`/`qdel` 래퍼(필요 시 `SGE_ROOT`/`SGE_CELL`/`PATH` export). 자격증명은 config만(로그 비노출). 원격 작업 디렉터리 `{CLUSTER_REMOTE_ROOT}/...`, 완료 시 `.out`(및 `*-pos-1.xyz`/`*-1.cell`/`*.ener`/`*.pdos` 등) 로컬 `simulations/{job_dir}/`로 회수(f5·체이닝이 읽음).

### MOCK 폴백
`USE_SGE=0`/SSH 실패 시 `app/shared/jobs_mock.py`(가짜 SCF 스트림, 치유 없이 성공). 분기는 `USE_SGE` 한 곳.

---

### 완료 정의 (DoD)
- [ ] run.sh가 **reference `SGE_TEMPLATE`와 동일**(★ venv `source {CP2K_VENV}` 줄 포함, `cp2k.psmp`, `cp2k_run.log` echo 2줄, placeholder는 `{job_name}`/`{inp_filename}`/`{out_filename}` 3개). `.env`에 `CP2K_VENV` 추가됨. retry는 `-pe`만 `8cpu 8`.
- [ ] qsub은 **원격 step_dir를 cwd로 `qsub {sh basename}`**; job_id `re.search(r'(\d+)', stdout)`; qstat state는 `{job_id}\s+\S+\s+\S+\s+\S+\s+(\S+)`; 등록 유예 6회/~60s, finished 후 `.out` 30s 대기.
- [ ] 실패 → `diagnose`(GEO_OPT 두 트리거·성공마커 5종·번역표·UNKNOWN_ERROR 포함) → **KB `heal` 먼저, AI `heal_with_ai`는 `not heal_logs or diag=="UNKNOWN_CRASH"`일 때만** → `heal_logs` 있으면 메타동기화 후 재제출(≤3), 없으면 `🛑 자가 치유 실패`, 3회 초과 `🛑 시도 횟수 초과`.
- [ ] `heal_with_ai`는 **3-튜플** `(options, logs, msg)`, 실패 시 `msg`=실패문자열(빈 문자열 아님). `@PARAM/`·`param_overrides`·byte-compare 게이트·사다리 주경로 호출 **없음**.
- [ ] `apply_physics_rules`(규칙 6개, POISSON/MAX_FORCE 임계·LBFGS 포함)·`apply_scf_repair`(4단계, logs만, **호출 안 함**)·`validate_and_correct`(relocate+physics, 단일패스; 3-pass는 `_submit_step`).
- [ ] 다중-CIF N개 각각 독립 자가치유. 성공 시 좌표 체이닝(5개 run_type, 프레임 끝-2줄·셀 크기). 완료 시 `all_finished`+flag. `get_job_status`는 `msg_to_text`로 문자열화.
- [ ] SGE는 SSH(paramiko)로, 자격증명 비노출.
