package audio

import (
	"bytes"
	"fmt"
	"time"

	"github.com/ebitengine/oto/v3"
)

// Play plays WAV audio data through the system speakers.
func Play(wavData []byte) error {
	header, pcmReader, err := ParseWAV(bytes.NewReader(wavData))
	if err != nil {
		return fmt.Errorf("parse WAV: %w", err)
	}

	var format oto.Format
	switch header.BitsPerSample {
	case 16:
		format = oto.FormatSignedInt16LE
	case 32:
		format = oto.FormatFloat32LE
	default:
		return fmt.Errorf("unsupported bits per sample: %d", header.BitsPerSample)
	}

	ctx, readyChan, err := oto.NewContext(&oto.NewContextOptions{
		SampleRate:   header.SampleRate,
		ChannelCount: header.Channels,
		Format:       format,
	})
	if err != nil {
		return fmt.Errorf("create audio context: %w", err)
	}
	<-readyChan

	player := ctx.NewPlayer(pcmReader)
	player.Play()

	for player.IsPlaying() {
		time.Sleep(10 * time.Millisecond)
	}

	return player.Close()
}
