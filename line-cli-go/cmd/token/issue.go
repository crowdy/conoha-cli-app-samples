package token

import (
	"fmt"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var issueCmd = &cobra.Command{
	Use:   "issue",
	Short: "Issue a v2 channel access token (client_credentials)",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireTokenFields(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		resp, err := tokenAPI.IssueChannelToken(
			"client_credentials",
			config.ChannelID(),
			config.ChannelSecret(),
		)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}

		p.Raw(map[string]any{
			"access_token": resp.AccessToken,
			"expires_in":   resp.ExpiresIn,
			"token_type":   resp.TokenType,
		})
		return nil
	},
}
