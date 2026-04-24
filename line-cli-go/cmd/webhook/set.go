package webhook

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var setCmd = &cobra.Command{
	Use:   "set",
	Short: "Set the webhook endpoint URL",
	RunE: func(cmd *cobra.Command, args []string) error {
		url, _ := cmd.Flags().GetString("url")
		if url == "" {
			return &config.ClientError{Msg: "--url is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		_, err = api.SetWebhookEndpoint(
			&messaging_api.SetWebhookEndpointRequest{
				Endpoint: url,
			},
		)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}

		p.Success("Webhook endpoint updated", map[string]string{
			"endpoint": url,
		})
		return nil
	},
}

func init() {
	setCmd.Flags().String("url", "", "webhook endpoint URL (required)")
	_ = setCmd.MarkFlagRequired("url")
}
