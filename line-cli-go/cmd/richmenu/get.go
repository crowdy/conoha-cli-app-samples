package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getCmd = &cobra.Command{
	Use:   "get",
	Short: "Get a rich menu by ID",
	RunE: func(cmd *cobra.Command, args []string) error {
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		resp, err := api.GetRichMenu(richMenuID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	getCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	RichMenuCmd.AddCommand(getCmd)
}
