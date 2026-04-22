package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List all rich menus",
	RunE: func(cmd *cobra.Command, args []string) error {
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenuList()
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	RichMenuCmd.AddCommand(listCmd)
}
