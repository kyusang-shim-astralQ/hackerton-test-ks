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
3. **프루닝**: `force_sync`가 아니면, 키 머리가 표준 섹션 목록(`DFT,SCF,MGRID,SUBSYS,CELL,COORD,MOTION,GEO_OPT,MD,PROPERTIES,TDDFPT,XC,XC_FUNCTIONAL,GLOBAL,FORCE_EVAL,EXT_RESTART,VIBRATIONAL_ANALYSIS,...`)이거나 키에 `/`가 있는 것만 남김.
4. `_recursive_govern(clean, ('ROOT',), governed_root, ...)` → `_enforce_physics(governed_root, mandatory)`.

**A-3. `_recursive_govern(options, current_path, current_dic, logs, tokens, global_root)`** — 각 키:
- `@CHILDREN`/`@PARAM`/`SECTION_PARAMETERS`/`_EXIST`는 메타로 통과. `ROOT` 키는 펼침.
- 키에 공백 있으면 `k, param` 분리(예 `KIND H` → k=KIND, param=H).
- **섹션/키워드 판정**: 값이 dict면 섹션. 아니면 현재 경로 스키마에 keyword로 있으면 키워드, 없고 `sections`에 있으면 섹션.
- `fuzzy_correct(k, current_path)`(alias_map → 현재경로 keyword/sub_section/sections 확인)로 정식명. 없으면: `@`로 시작(전처리 지시문)이면 보존; dict면 `PRUNE: Unknown section`(force_sync면 보존); 아니면 `PRUNE: Unknown`(force_sync면 보존).
- **좌표 가드**: dict 아닌데 키가 `C 1.2 3.4 5.6`처럼 4토큰+뒤3개 float면 좌표로 오인 → 거부.
- `_find_best_parent(name, current_path, is_section)`로 **올바른 부모 경로**를 찾아 재배치(현재 경로가 유효하면 그대로; 아니면 forward에서 그 이름을 갖는 경로들 중 현재 경로와 가장 prefix가 겹치는 것 선택). 그 경로로 `target_root`를 `setdefault` 하며 내려감.
- **repeats/KIND**: 섹션이 `repeats`이거나 `KIND`면 `actual_key = "{NAME} {PARAM}"`(KIND는 param 필수, 없으면 거부). 아니면 이름 통일(중복 병합).
- 섹션이면: 값이 문자열이면 dict로 전환(`XC_FUNCTIONAL`에 `PBE` 등 들어오면 `{PBE:{}}`로 전개, 그 외 `{@param: 값}`). `SECTION_PARAMETERS`→`@param` 승격. 재귀.
- 키워드면: `repeats`면 list로 누적, 아니면 값 설정.

**A-4. `_enforce_physics(root, mandatory, logs)`** — 물리 강제(순서대로):
1. `GLOBAL.PROJECT_NAME='CP2K_AGENT_FORCE_WRITE_V1'`, `GLOBAL.RUN_TYPE = mandatory.run_type`.
2. METHOD: `mandatory.method`(기본 GPW). QUICKSTEP이면 `FORCE_EVAL.METHOD=QUICKSTEP`, 아니면 `FORCE_EVAL.DFT.QS.METHOD=<method>`.
3. **파일 해석**(`resolve_files`): `DFT.BASIS_SET_FILE_NAME`/`POTENTIAL_FILE_NAME`를 basis_map.json + 휴리스틱으로 채움(엉터리 `BASIS_SET` 같은 값이면 강제 교정).
4. **SUBSYS**: 외부 COORD 파일 없으면 `SUBSYS.COORD.@children = atom_info.full_coord_text 줄들`(scaled면 `SCALED .TRUE.`). `SUBSYS.CELL.ABC = atom_info.cell 3값`, `PERIODIC`, `full_cell_text`에서 `ALPHA_BETA_GAMMA`. **원소별 `KIND <EL>`**: 없거나 BASIS/POT 누락이면 `{BASIS_SET: <basis>, POTENTIAL: <GTH-PBE 등>}` 보강.
5. **XC**: `@XC` 없으면 `DFT.XC.XC_FUNCTIONAL.@param = functional`(UPPER).
6. **OT vs DIAGONALIZATION**: `kpoints`(유효값)·TDDFPT·smear 중 하나면 `DIAGONALIZATION`(+ kpoints면 `DFT.KPOINTS.SCHEME=MONKHORST-PACK ...`/`SYMMETRY F`), 아니면 사용자 `scf_algo`(없으면 OT). OT면 `SCF.OT{MINIMIZER:DIIS, PRECONDITIONER:FULL_SINGLE_INVERSE}` + DIAGONALIZATION/MIXING 제거. DIAG면 `SCF.DIAGONALIZATION{}` + OT 제거.
7. 최종: `MGRID.CUTOFF`, `SCF.EPS_SCF`, `SCF.MAX_SCF`(mandatory에서), `ignore_scf_failure`면 `SCF.IGNORE_CONVERGENCE_FAILURE .TRUE.`, smear=False면 SMEAR 제거.
> 우리 제품은 **Gamma-point 전용**(k-point 미사용)이므로 `valid_kpts`는 항상 거짓 경로로 둔다 → 사실상 OT/사용자 알고리즘 경로만 사용. (kpoints 분기 코드는 두되 트리거 안 됨.)
> **★ enforcement는 `mandatory`(거버닝 파라미터)로 강제하며 3-pass의 맨 마지막에 실행된다.** `use_smear=False`면 `SMEAR` 제거, `scf_algo=OT`면 `MIXING`/`DIAGONALIZATION` 제거, `scf_algo`/`max_scf`/`eps_scf`/`cutoff`/파일을 항상 덮어쓴다. 따라서 **f4 자가치유(be/05)가 SCF 알고리즘·스미어·MAX_SCF 등을 바꾸려면 옵션 트리가 아니라 `mandatory`(= `suite_params`)를 갱신**해야 변경이 살아남는다 — 트리에만 넣은 `MIXING/SMEAR/ADDED_MOS`는 여기서 도로 지워진다(be/05 **★ 핵심 규칙**). 단, OT 하위 `MINIMIZER`/`PRECONDITIONER`는 `setdefault`로 채우므로 자가치유가 먼저 넣은 값은 **유지**되고, `OUTER_SCF`·`MOTION/*`·키워드/enum/파일명 교정도 유지된다.

**A-5. `dict_to_tree_schema_aware(options, current_path)` → node list**: `@children`→freetext 노드. list 값→중복 keyword 노드들. dict 값→section 노드(`name`=공백/`_DUPL_` 앞 순수명, `param`=키의 param 또는 `@param`, `children`=재귀). 그 외→keyword 노드(스키마 ENUM이면 값 UPPER).

**A-6. `get_manual_snippet(token)`**: forward에서 경로 끝이 token인 섹션/해당 token 키워드를 찾아 `### [SECTION] path / Keywords / Sub-sections` 또는 `### [KEYWORD] ... Default/Enums/Type` 스니펫 최대 5개. (f2 플랜·자가치유 프롬프트의 스키마 컨텍스트로 쓰임.)

**A-7. `resolve_files(basis, functional, mandatory)`**: basis_map.json `file_mapping`로 1:1 → 없으면 휴리스틱(`MOLOPT`→`BASIS_MOLOPT`, `-GTH`→`GTH_BASIS_SETS`, `6-31/CC-P`→`BASIS_SET`, GTH계 functional→`GTH_BASIS_SETS`, fallback `GTH_BASIS_SETS BASIS_MOLOPT BASIS_SET`). pot은 `GTH_POTENTIALS`(HFX계면 `HFX_BASIS`).

### B. `app/shared/options.py` (재구현)
- `parse_path_based_options(list[str])`: 각 줄 `^(.*/)?([A-Za-z0-9_]+)(?:\s+(.*))?$` 정규식 → 경로/키/값 분리, `&` 제거, `/`로 split → 중첩 dict(중복 키는 list).
- `deep_merge(base, update)`, `merge_custom_options`, `tree_to_lines`, `resolve_smart_placeholders`(FIXED_ATOMS ELEMENTS→인덱스).
- `tree_to_lines(node)`: ROOT는 GLOBAL/FORCE_EVAL/MOTION 순 정렬. section→`&{name} {param}` … `&END {name}`, keyword→`{name} {value}`, freetext→그대로. 2-space 들여쓰기.
- `PHYSICS_PATTERNS`(physics_patterns.py): total_energy/scf_step/homo_lumo/excitation/geo_max_grad 등 정규식(아래 be/05 모니터·f5 리포트가 공유).

### C. `app/features/inp/service.py` (재구현)
- `build_full_inp(tree, atom_info, step_idx, **kw)`:
  1. tree(list/dict)→`parse_path_based_options`/copy로 `ai_options`.
  2. `use_smear`면 `FORCE_EVAL/DFT/SCF/SMEAR/{METHOD FERMI_DIRAC, ELECTRONIC_TEMPERATURE <temp>}` 주입 + `SCF/ADDED_MOS <kwargs.added_mos 또는 20>`(없으면). 아니면 SMEAR 재귀 제거. (`added_mos`/`max_scf`/`eps_scf`는 mandatory로 받아 `_enforce_physics`가 강제 — f4 자가치유가 이 값을 올리면 그대로 반영된다.)
  3. **비직교 셀**(cell_angles가 90°에서 5°↑ 벗어남)이면 `SCF/MIXING/ALPHA 0.1`+`SCF/OUTER_SCF/MAX_SCF 50` 주입.
  4. **3-pass**: `for _ in range(3): ai_options,_ = healing_engine.validate_and_correct(ai_options, mandatory)`(mandatory에 run_type/step_idx/cutoff/functional/basis_set/method/scf_algo/eps_scf/atom_info 등). `validate_and_correct`는 be/05의 self_healing(= schema_engine.validate_and_relocate + physics_rules.apply_physics_rules).
  5. `schema_engine.dict_to_tree_schema_aware(ai_options)` → ROOT 노드 → `tree_to_lines` → `.inp` 텍스트.
- `generate_inp_logic(req)`: `selected & not exclude` 스텝만. `multi_atom_info` len>1이면 **구조별 × 스텝별** `{base}_step{i}.inp`, 아니면 스텝별 `step{i}.inp`. 각 호출에 step의 `inp_options`(+`custom_options` 병합)·atom_info·DFT 파라미터 전달.
- `router.py`: `POST /generate-inp` → `{status:"success", generated_files:[{filename,content}]}`.

### requirements
`lxml`(또는 표준 `xml.etree`), 기존 의존성.

### 완료 정의 (DoD)
- [ ] schema_engine이 `cp2k_input.xml`을 인덱싱(`forward`/`sections`/`alias_map`) + cache.pkl 생성.
- [ ] `build_full_inp`가 **relocate + _enforce_physics + 3-pass + dict_to_tree** 를 거쳐 `.inp` 생성(템플릿 아님).
- [ ] 플랜의 경로형 옵션이 **스키마의 올바른 `&SECTION` 위치로 재배치**되고, COORD/CELL/KIND가 atom_info에서 채워진 **유효 `.inp`**.
- [ ] 다중-CIF면 구조별×스텝별 `.inp` 모두 생성.
- [ ] OT/DIAGONALIZATION·BASIS/POTENTIAL·CUTOFF/EPS_SCF가 _enforce_physics로 강제됨.
