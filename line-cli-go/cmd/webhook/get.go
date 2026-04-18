package webhook

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get current webhook endpoint configuration",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.GetWebhookEndpoint()
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}

		p.Raw(map[string]any{
			"endpoint": resp.Endpoint,
			"active":   resp.Active,
		})
		return nil
	},
}
