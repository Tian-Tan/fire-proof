from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.rag_service import initialize_rag_store, load_seed_documents, seed_documents


def main() -> None:
    initialize_rag_store()
    inserted = seed_documents(load_seed_documents())
    print(f"Seeded {inserted} wildfire guidance chunks")


if __name__ == "__main__":
    main()
