package audio

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func buildTestWAV(sampleRate uint32, channels uint16, bitsPerSample uint16, pcmData []byte) []byte {
	buf := &bytes.Buffer{}
	dataSize := uint32(len(pcmData))
	fileSize := 36 + dataSize

	// RIFF header
	buf.WriteString("RIFF")
	binary.Write(buf, binary.LittleEndian, fileSize)
	buf.WriteString("WAVE")

	// fmt subchunk
	buf.WriteString("fmt ")
	binary.Write(buf, binary.LittleEndian, uint32(16)) // subchunk size
	binary.Write(buf, binary.LittleEndian, uint16(1))  // PCM format
	binary.Write(buf, binary.LittleEndian, channels)
	binary.Write(buf, binary.LittleEndian, sampleRate)
	byteRate := sampleRate * uint32(channels) * uint32(bitsPerSample) / 8
	binary.Write(buf, binary.LittleEndian, byteRate)
	blockAlign := channels * bitsPerSample / 8
	binary.Write(buf, binary.LittleEndian, blockAlign)
	binary.Write(buf, binary.LittleEndian, bitsPerSample)

	// data subchunk
	buf.WriteString("data")
	binary.Write(buf, binary.LittleEndian, dataSize)
	buf.Write(pcmData)

	return buf.Bytes()
}

func TestParseWAV_Valid(t *testing.T) {
	pcm := make([]byte, 100)
	wav := buildTestWAV(44100, 1, 16, pcm)

	header, pcmReader, err := ParseWAV(bytes.NewReader(wav))
	if err != nil {
		t.Fatalf("ParseWAV() error: %v", err)
	}
	if header.SampleRate != 44100 {
		t.Errorf("SampleRate = %d, want 44100", header.SampleRate)
	}
	if header.Channels != 1 {
		t.Errorf("Channels = %d, want 1", header.Channels)
	}
	if header.BitsPerSample != 16 {
		t.Errorf("BitsPerSample = %d, want 16", header.BitsPerSample)
	}

	data := make([]byte, 200)
	n, _ := pcmReader.Read(data)
	if n != 100 {
		t.Errorf("PCM data length = %d, want 100", n)
	}
}

func TestParseWAV_Stereo48k(t *testing.T) {
	pcm := make([]byte, 200)
	wav := buildTestWAV(48000, 2, 16, pcm)

	header, _, err := ParseWAV(bytes.NewReader(wav))
	if err != nil {
		t.Fatalf("ParseWAV() error: %v", err)
	}
	if header.SampleRate != 48000 {
		t.Errorf("SampleRate = %d, want 48000", header.SampleRate)
	}
	if header.Channels != 2 {
		t.Errorf("Channels = %d, want 2", header.Channels)
	}
}

func TestParseWAV_InvalidHeader(t *testing.T) {
	_, _, err := ParseWAV(bytes.NewReader([]byte("not a wav file")))
	if err == nil {
		t.Fatal("expected error for invalid WAV")
	}
}
