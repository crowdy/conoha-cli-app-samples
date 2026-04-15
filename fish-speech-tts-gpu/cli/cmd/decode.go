package cmd

import (
	"encoding/base64"
	"encoding/json"
	"fish-speech-cli/audio"
	"fish-speech-cli/client"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func NewDecodeCmd(getServer func() string) *cobra.Command {
	var inputFile, outputFile string
	var play bool

	cmd := &cobra.Command{
		Use:   "decode",
		Short: "Decode VQ tokens to audio",
		Example: `  fish-speech-cli decode --input tokens.json --output audio.wav
  fish-speech-cli decode --input tokens.json --play`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if inputFile == "" {
				return fmt.Errorf("--input is required")
			}

			tokenData, err := os.ReadFile(inputFile)
			if err != nil {
				return fmt.Errorf("read input: %w", err)
			}

			var tokens [][][]int
			if err := json.Unmarshal(tokenData, &tokens); err != nil {
				return fmt.Errorf("parse tokens: %w", err)
			}

			c := client.New(getServer())
			resp, err := c.Decode(tokens)
			if err != nil {
				return err
			}

			if len(resp.Audios) == 0 {
				return fmt.Errorf("no audio in response")
			}

			audioBytes, err := base64.StdEncoding.DecodeString(resp.Audios[0])
			if err != nil {
				return fmt.Errorf("decode audio base64: %w", err)
			}

			if outputFile != "" {
				if err := os.WriteFile(outputFile, audioBytes, 0644); err != nil {
					return fmt.Errorf("write output: %w", err)
				}
				fmt.Fprintf(os.Stderr, "Audio saved to %s\n", outputFile)
			}

			if play || outputFile == "" {
				fmt.Fprintf(os.Stderr, "Playing audio...\n")
				return audio.Play(audioBytes)
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&inputFile, "input", "i", "", "Input JSON token file (required)")
	cmd.Flags().StringVarP(&outputFile, "output", "o", "", "Output audio file")
	cmd.Flags().BoolVar(&play, "play", false, "Play audio after decoding")
	return cmd
}
