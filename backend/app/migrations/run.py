from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path


def _load_migration(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load migration {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("direction", choices=["up", "down"])
    args = parser.parse_args()

    migrations = sorted(
        Path(__file__).parent.glob("[0-9][0-9][0-9]_*.py"),
        key=lambda path: path.name,
        reverse=args.direction == "down",
    )
    for migration_path in migrations:
        migration = _load_migration(migration_path)
        if args.direction == "up":
            migration.upgrade()
        else:
            migration.downgrade()


if __name__ == "__main__":
    main()
