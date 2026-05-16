# voice-agent-conoha-l4/agent/app/services/tts.py
import asyncio
from pathlib import Path

import numpy as np
from style_bert_vits2.tts_model import TTSModel
from style_bert_vits2.nlp import bert_models
from style_bert_vits2.constants import Languages


class SBV2TTSService:
    def __init__(self, model_dir: str, device: str = "cuda") -> None:
        # SBV2 requires BERT model preload for Japanese.
        bert_models.load_model(Languages.JP, "ku-nlp/deberta-v2-large-japanese-char-wwm")
        bert_models.load_tokenizer(Languages.JP, "ku-nlp/deberta-v2-large-japanese-char-wwm")
        model_path = Path(model_dir)
        # Convention: one .safetensors + one config.json + one style_vectors.npy per voice
        weight = next(model_path.glob("*.safetensors"))
        config = model_path / "config.json"
        style = model_path / "style_vectors.npy"
        self._model = TTSModel(model_path=weight, config_path=config,
                               style_vec_path=style, device=device)

    async def synthesize(self, text: str, language: str) -> bytes:
        """Synthesize ``text`` to raw int16 PCM at 24 kHz.

        Note: this implementation always uses Japanese voice models
        (``Languages.JP``) regardless of the ``language`` argument.
        Callers passing ``"en"`` or ``"ko"`` will receive
        Japanese-pronunciation output.  Multi-language voice is out of
        scope for the current spec.
        """
        return await asyncio.get_running_loop().run_in_executor(
            None, self._synth_sync, text
        )

    def _synth_sync(self, text: str) -> bytes:
        sr, audio = self._model.infer(text=text, language=Languages.JP)
        # audio: numpy float32 [-1,1]. Resample/convert to int16 24000Hz.
        if sr != 24000:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=24000)
        pcm16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
        return pcm16.tobytes()
