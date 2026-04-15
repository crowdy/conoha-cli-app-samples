package cmd

import (
	"fish-speech-cli/client"
	"fmt"

	"github.com/spf13/cobra"
)

func NewHealthCmd(getServer func() string) *cobra.Command {
	return &cobra.Command{
		Use:   "health",
		Short: "Check server health status",
		RunE: func(cmd *cobra.Command, args []string) error {
			c := client.New(getServer())
			if err := c.Health(); err != nil {
				return fmt.Errorf("server is not healthy: %w", err)
			}
			fmt.Println("Server is healthy")
			return nil
		},
	}
}
