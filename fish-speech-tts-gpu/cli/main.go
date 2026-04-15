package main

import (
	"fish-speech-cli/cmd"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var serverURL string

var rootCmd = &cobra.Command{
	Use:   "fish-speech-cli",
	Short: "CLI client for Fish Speech TTS API",
}

func init() {
	rootCmd.PersistentFlags().StringVar(&serverURL, "server", "http://localhost:8080", "Fish Speech API server URL")

	getServer := func() string { return serverURL }

	rootCmd.AddCommand(cmd.NewHealthCmd(getServer))
	rootCmd.AddCommand(cmd.NewTTSCmd(getServer))
	rootCmd.AddCommand(cmd.NewRefCmd(getServer))
	rootCmd.AddCommand(cmd.NewEncodeCmd(getServer))
	rootCmd.AddCommand(cmd.NewDecodeCmd(getServer))
}

func main() {
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
