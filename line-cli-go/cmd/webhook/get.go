package webhook

import (
	"os"

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
			p.Error(0, err.Error())
			os.Exit(1)
		}

		p.Raw(map[string]any{
			"endpoint": resp.Endpoint,
			"active":   resp.Active,
		})
		return nil
	},
}
