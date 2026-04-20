package token

import (
	"fmt"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var verifyCmd = &cobra.Command{
	Use:   "verify",
	Short: "Verify a channel access token",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireAccessToken(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		resp, err := tokenAPI.VerifyChannelToken(config.AccessToken())
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}

		p.Raw(map[string]any{
			"client_id":  resp.ClientId,
			"expires_in": resp.ExpiresIn,
			"scope":      resp.Scope,
		})
		return nil
	},
}
