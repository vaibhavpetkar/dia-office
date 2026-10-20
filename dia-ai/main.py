"""Chat with the AI CEO from the terminal: python main.py"""
from dotenv import load_dotenv

load_dotenv()

from dia.ceo import build_ceo  # noqa: E402


def main() -> None:
    ceo = build_ceo()
    print("Dia AI CEO ready. Type a goal (or 'exit').")
    while (goal := input("\nYou: ").strip()) not in ("exit", "quit"):
        if goal:
            ceo(goal)
            print()


if __name__ == "__main__":
    main()
