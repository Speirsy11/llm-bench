# LLMBench

LLMBench is an agentic-first benchmarking platform for comparing models, harnesses, and toolsets under reproducible conditions.

The project is currently in its planned bootstrap state. Product decisions and the fourteen-PR delivery roadmap live in [`docs/planning`](docs/planning/DELIVERY_PLAN.md).

## Delivery model

- [`PRODUCT_PLAN.md`](docs/planning/PRODUCT_PLAN.md) is the stable product specification.
- [`DELIVERY_PLAN.md`](docs/planning/DELIVERY_PLAN.md) is the epic board and dependency map.
- [`AGENT_WORKFLOW.md`](docs/planning/AGENT_WORKFLOW.md) explains how an agent claims and completes one epic.
- Each file in [`docs/planning/epics`](docs/planning/epics) maps to one pull request.

Implementation begins with EPIC-01. The retained `tooling/` and `turbo/` directories are starter material to be renamed and hardened by that epic; they are not yet the LLMBench quality baseline.

## License

MIT
