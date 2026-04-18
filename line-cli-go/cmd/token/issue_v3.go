package token

import (
	"fmt"
	"os"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var issueV3Cmd = &cobra.Command{
	Use:   "issue-v3",
	Short: "Issue a v2.1 channel access token (JWT-based)",
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := config.RequireTokenFields(); err != nil {
			return err
		}
		p := output.NewPrinter(config.JSONMode(), nil)

		tokenAPI, err := client.NewChannelAccessTokenAPI()
		if err != nil {
			return fmt.Errorf("creating token client: %w", err)
		}

		// The mock does not verify JWT signatures, so a dummy assertion suffices.
		assertion := "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.dummy"

		resp, err := tokenAPI.IssueChannelTokenByJWT(
			"client_credentials",
			"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			assertion,
		)
		if err != nil {
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"access_token": resp.AccessToken,
			"expires_in":   resp.ExpiresIn,
			"token_type":   resp.TokenType,
			"key_id":       resp.KeyId,
		})
		return nil
	},
}
