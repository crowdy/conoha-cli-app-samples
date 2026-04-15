package cmd

import (
	"encoding/json"
	"fish-speech-cli/client"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func NewEncodeCmd(getServer func() string) *cobra.Command {
	var inputFile, outputFile string

	cmd := &cobra.Command{
		Use:   "encode",
		Short: "Encode audio to VQ tokens",
		Example: `  fish-speech-cli encode --input audio.wav --output tokens.json`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if inputFile == "" {
				return fmt.Errorf("--input is required")
			}

			audioData, err := os.ReadFile(inputFile)
			if err != nil {
				return fmt.Errorf("read input: %w", err)
			}

			c := client.New(getServer())
			resp, err := c.Encode(audioData)
			if err != nil {
				return err
			}

			jsonData, err := json.MarshalIndent(resp.Tokens, "", "  ")
			if err != nil {
				return fmt.Errorf("marshal tokens: %w", err)
			}

			if outputFile != "" {
				if err := os.WriteFile(outputFile, jsonData, 0644); err != nil {
					return fmt.Errorf("write output: %w", err)
				}
				fmt.Fprintf(os.Stderr, "Tokens saved to %s\n", outputFile)
			} else {
				fmt.Println(string(jsonData))
			}
			return nil
		},
	}

	cmd.Flags().StringVarP(&inputFile, "input", "i", "", "Input audio file (required)")
	cmd.Flags().StringVarP(&outputFile, "output", "o", "", "Output JSON file (prints to stdout if omitted)")
	return cmd
}
