# be/04 · f3-inp 백엔드 (✅ REAL · 원래 로직 재현 — schema_engine/XML)

> `be/01-foundation.md` 완료 후 실행. **reference 코드를 복사하지 않는다.** 아래 알고리즘 명세만 보고 **그대로 재구현**한다(원래 로직). 데이터 파일 `cp2k_input.xml`(+`.cache.pkl`)·`basis_map.json`만 `backend/app/shared/`에 둔다.

---

## 프롬프트

너는 백엔드 **f3-inp**를 구현한다. 핵심은 **34MB CP2K 스키마(`cp2k_input.xml`)를 인덱싱한 schema_engine으로 `.inp`를 생성**하는 것이다 — 플랜이 낸 경로형 옵션을 **실제 스키마 계층의 올바른 위치로 재배치(relocate)** 하고, **물리 정합성을 강제**하고, **3-pass 자가검증** 후 렌더한다. 아래 명세대로 **재구현**하라(문자열 템플릿 금지).

### 데이터 파일 (반입)
- `app/shared/cp2k_input.xml` (CP2K 입력 스키마), `app/shared/cp2k_input.xml.cache.pkl`(인덱스 캐시; 없으면 첫 로드 시 생성), `app/shared/basis_map.json`(기저→파일 매핑). schema_engine이 이 경로에서 읽는다.

### A. `app/shared/schema_engine.py` — `CP2KSchemaEngine` (재구현)
**A-1. 스키마 인덱싱(`_load_schema`)**: cache.pkl 있으면 로드. 없으면 `xml.etree.ElementTree`로 `cp2k_input.xml` 파싱 → 재귀 walk로 아래를 만들고 pkl로 캐시.
- `forward`: dict — 키는 경로 tuple `('ROOT','FORCE_EVAL','DFT','SCF',...)`, 값은 `{ "keywords": {KEYWORD_UPPER: {"type":"keyword","repeats":bool,"DEFAULT":str,"ENUM":[...]|None,"KIND":dtype}}, "sub_sections":[SEC_UPPER,...] }`. 또한 각 섹션 경로에 `{"repeats":bool,"has_params":bool}`(SECTION의 `repeats` 속성, `SECTION_PARAMETERS` 존재 여부).
- `sections`: 모든 섹션명(UPPER) set.
- `alias_map`: `{(current_path, NAME_UPPER): 첫_NAME_UPPER}` — 한 KEYWORD에 여러 `<NAME>` 별칭이 있으면 첫 이름이 정식.
- KEYWORD의 ENUM은 `.//ENUMERATION/ITEM/NAME`, DEFAULT는 `DEFAULT_VALUE`, KIND는 `DATA_TYPE@kind`.

**A-2. `validate_and_relocate(raw_options, mandatory)` → (governed_root, logs)**:
1. `normalize_dict_keys`: 모든 키 UPPER + 재귀, 충돌 시 deep merge.
2. **환각 보정**: 키에 `EXCITATION_KIND` 포함 → `FORCE_EVAL/PROPERTIES/TDDFPT/RKS_TRIPLETS`를 `T`/`F`(값에 TRIPLET 있으면 T)로. `CALC_OSCILLATOR`는 무시.
3. **프루닝**: `force_sync`가 아니면, `STANDARD_SECTIONS` = `['DFT','SCF','MGRID','SUBSYS','CELL','COORD','MOTION','GEO_OPT','MD','PROPERTIES','TDDFPT','XC','XC_FUNCTIONAL','GLOBAL','FORCE_EVAL','EXT_RESTART','VIBRATIONAL_ANALYSIS','FARMING','OPTIMIZE_BASIS','TEST']`(★ 20개 전부, `...` 금지). 예측: `{k:v for k,v in opts.items() if k and (k.split('_DUPL_')[0].split()[0].upper() in STANDARD_SECTIONS or '/' in k)}`.
4. `_recursive_govern(clean, ('ROOT',), governed_root, ...)` → `_enforce_physics(governed_root, mandatory)`.

**A-3. `_recursive_govern(options, current_path, current_dic, logs, tokens, global_root)`** — 각 키:
- `@CHILDREN`/`@PARAM`/`SECTION_PARAMETERS`/`_EXIST`는 메타로 통과. `ROOT` 키는 펼침.
- 키에 공백 있으면 `k, param` 분리(예 `KIND H` → k=KIND, param=H).
- **섹션/키워드 판정(★ 한 줄 `isinstance(v,dict)` 금지 — XC_FUNCTIONAL 버그의 근본 원인)**: 아래 **3-규칙**으로 `is_section`을 결정한다 — ① 값이 **dict** → 섹션. ② dict 아니어도 `fuzzy_correct(k,current_path)` 정식명이 **현재 경로 keywords에 존재** → 키워드. ③ ①②가 아니고 정식명이 **`self.sections`에 존재** → **섹션(문자열 값을 가진 섹션)** 으로 분류해 섹션 경로(`_place_section`)로 라우팅한다. (예: `XC_FUNCTIONAL`은 `sections`에 있으므로 값이 `"PBE"` 문자열이어도 **반드시 섹션**으로 분류해야 한다. `isinstance` 한 줄로만 판정하면 문자열 값 섹션이 키워드로 새서 `&XC` 안에 `XC_FUNCTIONAL PBE`(`&` 없는 키워드)로 렌더 → CP2K `found an unknown keyword XC_FUNCTIONAL in section XC`로 거부된다.)
- `fuzzy_correct(k, current_path)`(alias_map → 현재경로 keyword/sub_section/sections 확인)로 정식명. 없으면: `@`로 시작(전처리 지시문)이면 보존; dict면 `PRUNE: Unknown section`(force_sync면 보존); 아니면 `PRUNE: Unknown`(force_sync면 보존).
- **좌표 가드(★ `return`)**: dict 아닌데 `str(k).split()`이 4토큰↑이고 `parts[1:4]`가 모두 float면 좌표로 오인 → `[REJECT]` 로그 후 **`return`**(이 dict의 나머지 형제 키 처리까지 중단 — `continue` 아님). 바레 `KIND`(param 없음)도 `[REJECT]` 후 **`return`**.
- `_find_best_parent(name, current_path, is_section)`: `_is_valid_at_path`면 현재 경로 유지(맥락 우선); 아니면 forward에서 그 이름 가진 경로 수집 → `_score_path`(현재 경로와 동일 prefix 성분 수, 첫 불일치에서 중단) 내림차순 1등. 그 경로로 `target_root`를 `setdefault`하며 내려감.
- **repeats/KIND `actual_key`**: `repeats = forward.get(current_path+(target_name,),{}).get('repeats')`. `repeats or target_name=="KIND"`면 — `param` 있으면 `f"{target_name} {param.upper()}"`(★ param UPPER); elif raw 키에 `_DUPL_` 있으면 `f"{target_name}_DUPL_{raw.split('_DUPL_')[1]}"`; else **이미 `{target_name}_DUPL_`로 시작하는 형제가 있으면 `[PRUNE] redundant bare section` 후 `continue`**, 아니면 `target_name`. 아니면 `actual_key=target_name`.
- 섹션인데 값이 문자열(또는 비-dict)이면 dict로 **승격**: `"SECTION_PARAMETERS "` 접두 제거 후 **`{'@param': 값}`**(렌더 시 `&NAME 값`), 빈 값이면 `{'@children':[]}`. ★ **XC_FUNCTIONAL functional 화이트리스트(`PBE/BLYP/PADE/…`)는 제거** — `PBE0`·`HSE06`·`SCAN`·`B3LYP` 등 **어떤 functional 이름이 와도 `@param`으로 승격**되어 `&XC_FUNCTIONAL <이름> … &END XC_FUNCTIONAL`(섹션)으로 렌더돼야 한다(특정 목록에 없다고 키워드로 새는 일 0). `SECTION_PARAMETERS`→`@param` 승격(`@param`/`@children`/`_EXIST`를 소문자 키로 동기화, 빈 자리에만 덮어쓰기). 재귀.
- 키워드면: `repeats`면 list 누적, 아니면 값 설정(기존이 dict면 `target_val[k_up]=v`로 중첩).

> ### ★ 버그 수정: `&XC_FUNCTIONAL`이 키워드로 렌더되는 문제 (CP2K `found an unknown keyword XC_FUNCTIONAL in section XC`)
> **증상**: f2 플랜이 `inp_options`에 `"FORCE_EVAL/DFT/XC/XC_FUNCTIONAL PBE"`(키워드-값 형태)를 내면, 생성 `.inp`가 `&XC` 안에 `XC_FUNCTIONAL PBE`(`&` 없는 키워드)로 렌더돼 CP2K가 거부. 올바른 형태는 `&XC_FUNCTIONAL PBE … &END XC_FUNCTIONAL`(섹션, PBE는 섹션 파라미터).
> **근본 원인**: `_recursive_govern`의 섹션/키워드 판정이 **`isinstance(v,dict)` 단독**이면 문자열 값으로 들어온 "스키마상 섹션"(XC_FUNCTIONAL)을 키워드로 오분류한다. `_enforce_physics`의 XC 교정(A-4 §5)은 `functional` 인자가 `build_full_inp`에 전달될 때만 동작하므로, **플랜 경로(top-level `functional` 미전달)에선 보호가 뚫린다.**
> **수정(반드시 구현)**: ① 위 A-3 **3-규칙 판정**으로 `XC_FUNCTIONAL`을 sections 기준 섹션으로 분류. ② 문자열 값은 **`@param`으로 승격**(화이트리스트 없이 모든 functional). ③ A-4 §5 XC 교정은 그대로 두되, **그것에 의존하지 않고 ①②만으로** `functional` 미전달이어도 `&XC_FUNCTIONAL`이 항상 섹션으로 렌더돼야 한다.

**A-4. `_enforce_physics(root, mandatory, logs)`** — 물리 강제(전체 `try/except`로 감싸 예외 시 로그만 남기고 통과). `set_if_missing(d,k,v)` = **`(k 없음) 또는 (force_sync and v is not None)`이고 `v is not None`일 때만 기록**(★ force_sync 아니면 **기존값을 덮지 않고 빈 자리만** 채움). 순서:
1. `GLOBAL.PROJECT_NAME = 'CP2K_AGENT_FORCE_WRITE_V1'`(**무조건 대입**). `GLOBAL.RUN_TYPE = set_if_missing(run_type.upper())`(기본 ENERGY).
2. METHOD: `req_method = (mandatory.method or 'GPW').upper()`. `=='QUICKSTEP'`이면 `FORCE_EVAL.METHOD='QUICKSTEP'` + `DFT.QS.METHOD` 제거; 아니면 `DFT.QS.METHOD=req_method` + `FORCE_EVAL.METHOD` 제거. (**무조건**.)
3. **파일 해석**(`resolve_files`): `DFT.BASIS_SET_FILE_NAME`은 `(현재값 없음) or ('BASIS_SET' in str(현재값).upper()) or (not force_sync)`면 덮어씀 → **force_sync 아닌 우리 경로에선 사실상 항상 교정**(AI가 넣은 파일명도 교체). `POTENTIAL_FILE_NAME`도 `'POTENTIAL'` 기준 동일.
4. **SUBSYS**:
   - COORD: 트리에 `COORD_FILE_NAME` 포함 키가 있으면(재귀 탐색) `SUBSYS.COORD` 제거; 아니면 `atom_info.full_coord_text` 줄들(빈 줄 제외)을 `COORD.@children`로, `use_scaled`면 `SCALED .TRUE.` 아니면 SCALED 제거.
   - CELL: `CELL.PERIODIC = mandatory.periodic or atom_info.periodic or 'XYZ'`; `CELL.ABC = f"{c0:.10f} {c1:.10f} {c2:.10f}"`(★ **소수 10자리**); `atom_info.full_cell_text`에서 `re.search(r'ALPHA_BETA_GAMMA\s+([\d\.\s]+)')` 매치 시 `CELL.ALPHA_BETA_GAMMA = m.group(1).strip()`.
   - **원소별 `KIND <EL>`**: basis 파일→basis명 보정 — `'GTH_BASIS' in b_file and 'MOLOPT' in basis.upper()`면 `basis='DZVP-GTH'`; elif `'BASIS_SET' in b_file and 'MOLOPT' in basis.upper()`면 `func_suffix = 'PADE' if 'PADE' in func.upper() else ('PBE' if 'PBE' in func.upper() else 'PADE')`, `basis=f'DZVP-GTH-{func_suffix}'`. `default_pot = "GTH-PBE" if "PBE" in func.upper() else "GTH-PADE"`. 각 `el in set(elements)`: `KIND {EL_UP}`가 없거나 dict 아니거나 **BASIS_SET·POTENTIAL 둘 다 없을 때만**(★ AND) `{"BASIS_SET": basis, "POTENTIAL": pot_map.get(el_up, default_pot)}`로 재구성.
5. **XC**: `@XC`로 시작하는 키가 없고 func 있으면 `xc_sec = DFT.XC.XC_FUNCTIONAL`(setdefault). force_sync 아니면 **`xc_sec.clear()`**(★ AI가 넣은 하위 functional 비움) 후 `xc_sec['@param']=func.upper()`, `xc_sec.pop(func.upper(),None)`.
6. **OT vs DIAGONALIZATION**: `kpts_val = mandatory.kpoints`; `valid_kpts = kpts_val and str(kpts_val).strip().upper() not in ["","NONE","NULL","GAMMA","GAMMA-POINT"]`; `has_kpts = 'KPOINTS' in dft or valid_kpts`; `is_tddfpt = run_type=='TDDFPT' or 'TDDFPT' in dft`; `use_smear is True`(엄격 True). 이 중 하나면 → **DIAG**(`scf.setdefault('DIAGONALIZATION',{})`, `scf.pop('OT')`; has_kpts·not tddfpt면 `KPOINTS.SYMMETRY='F'` + valid_kpts면 `SCHEME='MONKHORST-PACK '+k`(이미 MONKHORST면 그대로)). 아니면 `scf_algo`(또는 트리 OT/DIAG, 없으면 OT). **OT면** `scf.OT.setdefault('MINIMIZER','DIIS')`, `setdefault('PRECONDITIONER','FULL_SINGLE_INVERSE')`, `scf.pop('DIAGONALIZATION')`, `scf.pop('MIXING')`. **DIAG면** `scf.setdefault('DIAGONALIZATION',{})`, `scf.pop('OT')`.
7. **최종**: `set_if_missing(MGRID.CUTOFF, cutoff)`, `set_if_missing(SCF.EPS_SCF, eps_scf)`, `set_if_missing(SCF.MAX_SCF, max_scf)`(★ 셋 다 **없을 때만**). `ignore_scf_failure`면 `SCF.IGNORE_CONVERGENCE_FAILURE='.TRUE.'`. `use_smear is False`면 `SCF.SMEAR` 제거. **charge/multiplicity/LSD는 enforce하지 않는다**(reference에 없음 — mandatory에 와도 무시되어 `.inp`에 안 나타남).
> 우리 제품은 **Gamma-point 전용**(k-point 미사용)이므로 `valid_kpts`는 사실상 항상 거짓 → OT/사용자 알고리즘 경로만 사용.
> **★ 무엇이 매번 강제되고 무엇이 빈 자리만 채워지나(자가치유 이해의 핵심)**: enforcement는 3-pass의 **맨 마지막**에 `mandatory`로 돈다. **항상 강제(덮어씀)** = PROJECT_NAME·METHOD·파일명·XC(`@param`+clear)·OT/DIAG 알고리즘, 그리고 (`use_smear` False면) `SMEAR` 제거·(OT면) `MIXING`/`DIAGONALIZATION` 제거. **빈 자리만 채움(`set_if_missing`, 기존값 유지)** = RUN_TYPE·CUTOFF·EPS_SCF·MAX_SCF. 따라서 자가치유(be/05)가 트리에 **EPS_SCF/CUTOFF/MAX_SCF 같은 스칼라 키워드**를 새로 넣으면 살아남지만, **MIXING/SMEAR(OT·non-smear 상황)·파일명·XC 하위**는 enforcement가 되돌린다(이게 SCF 미수렴 치유가 약한 reference 특성).

**A-5. `dict_to_tree_schema_aware(options, current_path)` → node list**: `@children`→freetext 노드. list 값→중복 keyword 노드들. dict 값→section 노드(`name`=공백/`_DUPL_` 앞 순수명, `param`=키의 param 또는 `@param`, `children`=재귀). 그 외→keyword 노드(스키마 ENUM이면 값 UPPER).

**A-6. `get_manual_snippet(token)`**: forward에서 경로 끝이 token인 섹션/해당 token 키워드를 찾아 `### [SECTION] path / Keywords / Sub-sections` 또는 `### [KEYWORD] ... Default/Enums/Type` 스니펫 최대 5개. (f2 플랜·자가치유 프롬프트의 스키마 컨텍스트로 쓰임.)

**A-7. `resolve_files(basis, functional, mandatory) → (basis_file, pot_file)`**:
- `b_file = mandatory.basis_file`, `p_file = mandatory.pot_file`(명시되면 우선). `STANDARD_BASIS_FILES = ["GTH_BASIS_SETS","BASIS_MOLOPT","BASIS_SET","HFX_BASIS","EMSL_BASIS_SETS"]`. `b_file`가 `ALL_BASIS_SETS`거나 이 목록에 없으면 `b_file=None`(재유도).
- b_file 없으면(순서): `basis_map.json`의 `file_mapping`에 `basis.upper()` 있으면 그 값(단 결과가 `BASIS_MOLOPT_UCL`인데 basis에 `UCL` 없으면 `BASIS_MOLOPT`로 교정); elif `MOLOPT`→`BASIS_MOLOPT`; elif `-GTH`→`GTH_BASIS_SETS`; elif `6-31`/`CC-P`/`AUG-CC` 포함→`BASIS_SET`; elif `DEF2`→`BASIS_def2_QZVP_RI_ALL`; elif GTH계 functional(`PBE/PADE/BLYP/LDA` 중 포함)→`GTH_BASIS_SETS`; else `'GTH_BASIS_SETS BASIS_MOLOPT BASIS_SET'`(공백 결합 3개).
- p_file 없으면: functional에 `HFX` 또는 `HYB` 포함이면 `HFX_BASIS`, 아니면 `GTH_POTENTIALS`.

### B. `app/shared/options.py` (재구현)
- `parse_path_based_options(list[str])`: 각 줄 `^(.*/)?([A-Za-z0-9_]+)(?:\s+(.*))?$` 정규식 → 경로/키/값 분리, `&` 제거, `/`로 split → 중첩 dict(중복 키는 list).
- `deep_merge(base, update)`, `merge_custom_options`, `tree_to_lines`, `resolve_smart_placeholders`(FIXED_ATOMS ELEMENTS→인덱스).
- `tree_to_lines(node)`: ROOT는 GLOBAL/FORCE_EVAL/MOTION 순 정렬. section→`&{name} {param}` … `&END {name}`, keyword→`{name} {value}`, freetext→그대로. 2-space 들여쓰기.
- `PHYSICS_PATTERNS`(physics_patterns.py): total_energy/scf_step/homo_lumo/excitation/geo_max_grad 등 정규식(아래 be/05 모니터·f5 리포트가 공유).

### C. `app/features/inp/service.py` (재구현)
- `build_full_inp(tree, atom_info, step_idx, **kw)`:
  1. tree(list/dict)→`parse_path_based_options`/`deepcopy`로 `ai_options`. `use_smear=kw.get('use_smear',False)`, `smear_temp=kw.get('smear_temp',300.0)`.
  2. `use_smear`면 `ai_options = deep_merge(ai_options, parse([...]))`로 `FORCE_EVAL/DFT/SCF/SMEAR/METHOD FERMI_DIRAC`·`.../ELECTRONIC_TEMPERATURE {smear_temp}` 주입(이 경우 smear가 AI값을 이김). 그리고 `FORCE_EVAL/DFT/SCF`에 대소문자/`&` 무시 `ADDED_MOS`가 **없을 때만** `scf["ADDED_MOS"] = "20"`(★ **문자열 리터럴 "20"**, `added_mos` kwarg 받지 않음, `_enforce_physics`는 ADDED_MOS를 건드리지 않음). `use_smear` 아니면 키에 `"SMEAR"`(`.upper().lstrip('&').strip()`==`SMEAR`) 든 항목 재귀 제거.
  3. **비직교 셀**: `_is_non_orthogonal_cell` = `cell_angles` 길이≥3이고 `any(abs(a-90.0)>5.0)`. 참이면 `ai_options = deep_merge(parse(["FORCE_EVAL/DFT/SCF/MIXING/ALPHA 0.1","FORCE_EVAL/DFT/SCF/OUTER_SCF/MAX_SCF 50"]), ai_options)` — ★ **triclinic이 base·ai가 update라 AI값이 이김**(triclinic은 빈 자리 기본값). (이후 OT면 enforcement가 MIXING 제거, OUTER_SCF는 유지.)
  4. `mandatory = {k:v for k,v in kw.items() if v is not None}`; `mandatory['atom_info']=atom_info`; `mandatory['step_idx']=step_idx`(★ **None인 kwarg는 제외** — 예 `max_scf` 기본 None이면 mandatory에서 빠짐). **3-pass**: `for _ in range(3): ai_options,_ = healing_engine.validate_and_correct(ai_options, mandatory)`(= `schema_engine.validate_and_relocate` + `physics_rules.apply_physics_rules`). ★ `apply_physics_rules`가 매 패스 **`FORCE_EVAL/DFT/POISSON{PERIODIC=<셀 주기성>}`(NONE이면 +`POISSON_SOLVER MT`, PSOLVER 제거)를 주입**하고 GEO_OPT MAX_FORCE/RMS_FORCE 완화·>50원자 LBFGS도 적용 → 생성 `.inp`엔 항상 `&POISSON`이 들어간다(be/05 §A).
  5. `engine.dict_to_tree_schema_aware(ai_options)` → `{"type":"section","name":"ROOT","children":nodes}` → `tree_to_lines` → `.inp` 텍스트(끝에 `\n`).
- `generate_inp_logic(req)`: `selected & not exclude` 스텝만. `multi_atom_info` len>1이면 **구조별 × 스텝별** `{base}_step{i}.inp`(`base=filename.replace(".cif","").replace(" ","_")`), 아니면 스텝별 `step{i}.inp`. 각 호출에 step `inp_options`(list면 parse; `custom_options` 있으면 `merge_custom_options(tree, custom, step_idx)`)·atom_info·DFT 파라미터 전달. 다중 구조면 `kpoints`(=`struct.get("verified_optimal_kpoint") or struct.get("initial_guess_kpoint") or req.kpoints`)·use_smear·smear_temp는 struct 우선. (Gamma 전용이라 kpoints는 사실상 None.)
- `router.py`: `POST /generate-inp` → `{status:"success", generated_files:[{filename,content}]}`.

### requirements
`lxml`(또는 표준 `xml.etree`), 기존 의존성.

### 완료 정의 (DoD)
- [ ] schema_engine이 `cp2k_input.xml`을 인덱싱(`forward`/`sections`/`alias_map`) + cache.pkl 생성.
- [ ] `build_full_inp`가 **relocate + _enforce_physics + 3-pass + dict_to_tree** 를 거쳐 `.inp` 생성(템플릿 아님).
- [ ] 플랜의 경로형 옵션이 **스키마의 올바른 `&SECTION` 위치로 재배치**되고, COORD/CELL/KIND가 atom_info에서 채워진 **유효 `.inp`**.
- [ ] 다중-CIF면 구조별×스텝별 `.inp` 모두 생성.
- [ ] OT/DIAGONALIZATION·BASIS/POTENTIAL·CUTOFF/EPS_SCF가 _enforce_physics로 강제됨.
- [ ] **`build_full_inp(["FORCE_EVAL/DFT/XC/XC_FUNCTIONAL PBE"], atom_info, functional=None …)`(★ top-level functional 미전달)** → 출력에 `&XC_FUNCTIONAL PBE`/`&END XC_FUNCTIONAL`(섹션)이 있고 `XC_FUNCTIONAL PBE`(`&` 없는 키워드 줄)는 **없어야** 한다.
- [ ] functional 이름이 화이트리스트 밖(`PBE0`/`HSE06` 등)이어도 `&XC_FUNCTIONAL <이름>` 섹션으로 렌더된다. 문자열 값으로 들어온 다른 스키마 섹션도 키워드로 새지 않는다.
