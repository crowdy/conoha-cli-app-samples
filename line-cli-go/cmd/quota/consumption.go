package quota

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var consumptionCmd = &cobra.Command{
	Use:   "consumption",
	Short: "Get current message quota consumption",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		resp, err := api.GetMessageQuotaConsumption()
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}

		p.Raw(map[string]any{
			"totalUsage": resp.TotalUsage,
		})
		return nil
	},
}
