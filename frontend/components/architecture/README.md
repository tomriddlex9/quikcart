# Architecture component integration

`ArchitectureLineage` is intentionally exported without editing
`frontend/app/architecture/page.tsx`, which is owned by the architecture-page
integrator. Add `<ArchitectureLineage />` where the page should show the live
raw → Bronze → Silver / filtered → Gold table lineage section.
