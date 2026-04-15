package cmd

import (
	"fish-speech-cli/audio"
	"fish-speech-cli/client"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func NewTTSCmd(getServer func() string) *cobra.Command {
	var (
		text        string
		output      string
		format      string
		refID       string
		play        bool
		temperature float64
		topP        float64
	)

	cmd := &cobra.Command{
		Use:   "tts",
		Short: "Convert text to speech",
		Example: `  # Play directly
  fish-speech-cli tts -t "Hello, world!"

  # Save to file
  fish-speech-cli tts -t "Hello" -o hello.wav

  # Use a reference voice
  fish-speech-cli tts -t "Hello" --ref my-voice

  # Change format
  fish-speech-cli tts -t "Hello" -o hello.mp3 --format mp3`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if text == "" {
				return fmt.Errorf("--text is required")
			}

			c := client.New(getServer())
			req := client.TTSRequest{
				Text:   text,
				Format: format,
			}
			if refID != "" {
				req.ReferenceID = refID
			}
			if cmd.Flags().Changed("temperature") {
				req.Temperature = temperature
			}
			if cmd.Flags().Changed("top-p") {
				req.TopP = topP
			}

			fmt.Fprintf(os.Stderr, "Generating speech...\n")
			data, err := c.TTS(req)
			if err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr, "Received %d bytes of audio\n", len(data))

			// Save to file if output specified
			if output != "" {
				if err := os.WriteFile(output, data, 0644); err != nil {
					return fmt.Errorf("write file: %w", err)
				}
				fmt.Fprintf(os.Stderr, "Saved to %s\n", output)
				if !play {
					return nil
				}
			}

			// Play audio
			if play || output == "" {
				if format != "wav" {
					return fmt.Errorf("playback only supports WAV format (got %s)", format)
				}
				fmt.Fprintf(os.Stderr, "Playing audio...\n")
				return audio.Play(data)
			}

			return nil
		},
	}

	cmd.Flags().StringVarP(&text, "text", "t", "", "Text to convert to speech (required)")
	cmd.Flags().StringVarP(&output, "output", "o", "", "Output file path (if omitted, plays directly)")
	cmd.Flags().StringVar(&format, "format", "wav", "Output format: wav, mp3, opus")
	cmd.Flags().StringVar(&refID, "ref", "", "Reference voice ID for voice cloning")
	cmd.Flags().BoolVar(&play, "play", false, "Force playback even when saving to file")
	cmd.Flags().Float64Var(&temperature, "temperature", 0.8, "Generation temperature (0.1-1.0)")
	cmd.Flags().Float64Var(&topP, "top-p", 0.8, "Top-p sampling (0.1-1.0)")

	return cmd
}
