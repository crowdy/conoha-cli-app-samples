package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var cancelDefaultCmd = &cobra.Command{
	Use:   "cancel-default",
	Short: "Cancel the default rich menu",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.CancelDefaultRichMenu(); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}
		p.Success("Default rich menu cancelled", nil)
		return nil
	},
}

func init() {
	RichMenuCmd.AddCommand(cancelDefaultCmd)
}
