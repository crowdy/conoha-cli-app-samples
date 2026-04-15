package audio

import (
	"encoding/binary"
	"fmt"
	"io"
)

// WAVHeader contains parsed WAV file metadata.
type WAVHeader struct {
	SampleRate    int
	Channels      int
	BitsPerSample int
}

// ParseWAV parses a WAV file header and returns metadata plus an io.Reader for the PCM data.
func ParseWAV(r io.Reader) (*WAVHeader, io.Reader, error) {
	// Read RIFF header (12 bytes)
	var riffHeader [12]byte
	if _, err := io.ReadFull(r, riffHeader[:]); err != nil {
		return nil, nil, fmt.Errorf("read RIFF header: %w", err)
	}
	if string(riffHeader[:4]) != "RIFF" || string(riffHeader[8:12]) != "WAVE" {
		return nil, nil, fmt.Errorf("not a valid WAV file")
	}

	header := &WAVHeader{}

	// Read chunks until we find "data"
	for {
		var chunkHeader [8]byte
		if _, err := io.ReadFull(r, chunkHeader[:]); err != nil {
			return nil, nil, fmt.Errorf("read chunk header: %w", err)
		}
		chunkID := string(chunkHeader[:4])
		chunkSize := binary.LittleEndian.Uint32(chunkHeader[4:8])

		switch chunkID {
		case "fmt ":
			if chunkSize < 16 {
				return nil, nil, fmt.Errorf("fmt chunk too small: %d", chunkSize)
			}
			var fmtData [16]byte
			if _, err := io.ReadFull(r, fmtData[:]); err != nil {
				return nil, nil, fmt.Errorf("read fmt chunk: %w", err)
			}
			audioFormat := binary.LittleEndian.Uint16(fmtData[0:2])
			if audioFormat != 1 {
				return nil, nil, fmt.Errorf("unsupported audio format: %d (only PCM supported)", audioFormat)
			}
			header.Channels = int(binary.LittleEndian.Uint16(fmtData[2:4]))
			header.SampleRate = int(binary.LittleEndian.Uint32(fmtData[4:8]))
			header.BitsPerSample = int(binary.LittleEndian.Uint16(fmtData[14:16]))

			// Skip extra fmt bytes if any
			if chunkSize > 16 {
				io.CopyN(io.Discard, r, int64(chunkSize-16))
			}

		case "data":
			return header, io.LimitReader(r, int64(chunkSize)), nil

		default:
			// Skip unknown chunks
			io.CopyN(io.Discard, r, int64(chunkSize))
		}
	}
}
