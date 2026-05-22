import sys
from pathlib import Path

# Allow `from app...` imports when pytest is run from the sample directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
