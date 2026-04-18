package webhook

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var testCmd = &cobra.Command{
	Use:   "test",
	Short: "Test the webhook endpoint connectivity",
	RunE: func(cmd *cobra.Command, args []string) error {
		url, _ := cmd.Flags().GetString("url")
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		req := &messaging_api.TestWebhookEndpointRequest{}
		if url != "" {
			req.Endpoint = url
		}

		resp, err := api.TestWebhookEndpoint(req)
		if err != nil {
			p.Error(0, err.Error())
			return err
		}

		p.Raw(map[string]any{
			"success":    resp.Success,
			"timestamp":  resp.Timestamp,
			"statusCode": resp.StatusCode,
			"reason":     resp.Reason,
			"detail":     resp.Detail,
		})
		return nil
	},
}

func init() {
	testCmd.Flags().String("url", "", "webhook URL to test (optional)")
}
