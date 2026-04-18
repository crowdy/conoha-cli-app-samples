package token

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var listKidsCmd = &cobra.Command{
	Use:   "list-kids",
	Short: "List valid key IDs for v2.1 tokens",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireTokenFields(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		assertion := "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.dummy"
		resp, err := tokenAPI.GetsAllValidChannelAccessTokenKeyIds(
			"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			assertion,
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"kids": resp.Kids,
		})
		return nil
	},
}
