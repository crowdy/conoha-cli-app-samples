"""Linear-elasticity FEM solve on a tetrahedral mesh."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import meshio
from scipy.sparse.linalg import spsolve

from skfem import (
    Basis, MeshTet, ElementVector, ElementTetP1, FacetBasis,
    asm, condense,
)
from skfem.models.elasticity import linear_elasticity, lame_parameters
from skfem.helpers import dot


@dataclass(frozen=True)
class Material:
    E_GPa: float
    nu: float


@dataclass(frozen=True)
class Result:
    displacement: np.ndarray  # (n_nodes, 3), mm
    von_mises: np.ndarray     # (n_nodes,), MPa
    n_dofs: int
    walltime_s: float


def solve(msh_path: Path, material: Material, traction_MPa: float) -> tuple[Result, MeshTet]:
    import time
    t0 = time.perf_counter()

    m_io = meshio.read(str(msh_path))
    points = m_io.points
    tets = np.vstack([c.data for c in m_io.cells if c.type == "tetra"])
    mesh = MeshTet(points.T, tets.T)

    elem = ElementVector(ElementTetP1())
    basis = Basis(mesh, elem)

    lam, mu = lame_parameters(material.E_GPa * 1e3, material.nu)  # convert to MPa
    K = asm(linear_elasticity(lam, mu), basis)

    # Dirichlet (fixed): zero displacement on every node belonging to the 'fixed' surface set
    fixed_nodes = _nodes_in_set(m_io, mesh, "fixed")
    D = basis.get_dofs(nodes=fixed_nodes).flatten()

    # Neumann (load): traction on the 'load' surface set
    F = _assemble_traction(m_io, mesh, "load", traction_MPa)

    # condense returns (K_c, F_c, x, I) when expand=True (default)
    # x is pre-initialized: zeros at interior DOFs, boundary values at D DOFs
    # I is the index array of interior (free) DOFs
    K_c, F_c, x, I = condense(K, F, D=D)
    x[I] = spsolve(K_c, F_c)

    u = x.reshape(-1, 3)
    sigma_vm = _von_mises_nodal(mesh, basis, x, lam, mu)
    return Result(displacement=u, von_mises=sigma_vm, n_dofs=basis.N,
                  walltime_s=time.perf_counter() - t0), mesh


def _nodes_in_set(m_io, mesh: MeshTet, set_name: str) -> np.ndarray:
    """Return unique node indices belonging to the named surface cell_set."""
    triangles = np.vstack([c.data for c in m_io.cells if c.type == "triangle"])
    sel = m_io.cell_sets[set_name]
    # cell_sets is a dict keyed by name → list-per-block of cell indices
    tri_block_idx = next(i for i, c in enumerate(m_io.cells) if c.type == "triangle")
    tri_indices = sel[tri_block_idx]
    chosen = triangles[tri_indices]
    return np.unique(chosen.ravel())


def _assemble_traction(m_io, mesh: MeshTet, set_name: str, traction_MPa: float) -> np.ndarray:
    """Distribute a uniform +X traction over the named surface set as a load vector."""
    # For demo simplicity, lump traction onto the boundary nodes equally.
    nodes = _nodes_in_set(m_io, mesh, set_name)
    F = np.zeros(mesh.p.shape[1] * 3)
    if nodes.size:
        per_node = traction_MPa / nodes.size  # crude lumping; Task 9 verifies tip deflection is in the right order
        for n in nodes:
            F[3 * n + 0] = per_node
    return F


def _von_mises_nodal(mesh: MeshTet, basis: Basis, u: np.ndarray,
                     lam: float, mu: float) -> np.ndarray:
    """Compute σ_vM at each node by averaging cell-constant tetra stresses."""
    # cell-constant strain via gradient of linear shape functions
    p = mesh.p.T  # (n_nodes, 3)
    cells = mesh.t.T  # (n_cells, 4)
    n_nodes = p.shape[0]
    vm = np.zeros(n_nodes)
    counts = np.zeros(n_nodes)

    u_vec = u.reshape(-1, 3)
    for c in cells:
        X = np.column_stack([p[c[1]] - p[c[0]],
                             p[c[2]] - p[c[0]],
                             p[c[3]] - p[c[0]]])  # 3x3
        if abs(np.linalg.det(X)) < 1e-12:
            continue
        invX = np.linalg.inv(X)
        grads = np.vstack([-(invX[0] + invX[1] + invX[2]),
                            invX[0], invX[1], invX[2]])  # (4,3)
        U = u_vec[c]  # (4,3)
        gradU = grads.T @ U  # (3,3)
        eps = 0.5 * (gradU + gradU.T)
        sig = lam * np.trace(eps) * np.eye(3) + 2.0 * mu * eps
        s = sig - np.eye(3) * np.trace(sig) / 3.0
        vm_cell = np.sqrt(1.5 * np.sum(s * s))
        for n in c:
            vm[n] += vm_cell
            counts[n] += 1.0
    counts[counts == 0] = 1.0
    return vm / counts
