#$ -N level
#$ -V
#$ -cwd
#$ -S /bin/bash
#$ -q gp3
#$ -pe 16cpu 16
#$ -o step1.out
#$ -e step1.err

source /var/lib/gridengine/default/common/settings.sh 2>/dev/null
source /DATA/lab07/hglee/cp2k_agent/venv/bin/activate 2>/dev/null

export FI_PROVIDER=tcp
export MKL_DEBUG_CPU_TYPE=5
export CP2K_ROOT=/share/cp2k-2026.1_mkl
export LD_LIBRARY_PATH=$CP2K_ROOT/lib:$LD_LIBRARY_PATH
export OMP_NUM_THREADS=1
source /share/intel/oneAPI/setvars.sh
ulimit -s unlimited

MPI_EXE=/share/intel/oneAPI/mpi/2021.17/bin/mpiexec
if [ ! -f "$MPI_EXE" ]; then
    MPI_EXE=$(which mpiexec)
fi

$MPI_EXE -n 16 $CP2K_ROOT/bin/cp2k.psmp -i H2O_tddfpt-s-1.inp > step1.out 2>&1
