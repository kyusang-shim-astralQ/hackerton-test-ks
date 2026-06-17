#!/bin/bash
#$ -N L4_C_BAND
#$ -V
#$ -cwd
#$ -S /bin/bash
#$ -q gp3
#$ -pe 16cpu 16

export FI_PROVIDER=tcp
export MKL_DEBUG_CPU_TYPE=5
export CP2K_ROOT=/share/cp2k-2026.1_mkl
export LD_LIBRARY_PATH=$CP2K_ROOT/lib:$LD_LIBRARY_PATH
export OMP_NUM_THREADS=1
source /share/intel/oneAPI/setvars.sh
ulimit -s unlimited

/share/intel/oneAPI/mpi/2021.17/bin/mpiexec -n 8 $CP2K_ROOT/bin/cp2k.psmp -i L4_Official.inp > calculation.out 2>&1
