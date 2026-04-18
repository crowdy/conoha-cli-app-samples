package token

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

// buildDummyJWT creates a JWT with the channel ID as the `iss` claim.
// The mock does not verify signatures, so only the payload matters.
func buildDummyJWT(channelID string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload, _ := json.Marshal(map[string]string{"iss": channelID})
	body := base64.RawURLEncoding.EncodeToString(payload)
	return header + "." + body + ".dummy-signature"
}

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

		// Build a JWT with channel ID as iss claim.
		// The mock extracts iss to identify the channel (no signature verification).
		assertion := buildDummyJWT(config.ChannelID())

		resp, err := tokenAPI.IssueChannelTokenByJWT(
			"client_credentials",
			"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			assertion,
		)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
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
