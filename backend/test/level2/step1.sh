#$ -N L2_H2O_SPE
#$ -V
#$ -cwd
#$ -S /bin/bash
#$ -q gp3
# [수정] gp3의 8코어 전용 환경 이름인 '8cpu'를 사용합니다.
#$ -pe 8cpu 8

export FI_PROVIDER=tcp
export MKL_DEBUG_CPU_TYPE=5
export CP2K_ROOT=/share/cp2k-2026.1_mkl
export LD_LIBRARY_PATH=$CP2K_ROOT/lib:$LD_LIBRARY_PATH
export OMP_NUM_THREADS=1
source /share/intel/oneAPI/setvars.sh
ulimit -s unlimited

# 이제 8개 노드가 비어 있으므로, qsub 시 즉시 Running(r) 상태로 바뀔 것입니다.
/share/intel/oneAPI/mpi/2021.17/bin/mpiexec -n 8 $CP2K_ROOT/bin/cp2k.psmp -i L2_Official.inp > calculation.out 2>&1
