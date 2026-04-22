package alias

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var updateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update the rich menu ID an alias points to",
	RunE: func(cmd *cobra.Command, args []string) error {
		aliasID, _ := cmd.Flags().GetString("alias-id")
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		if aliasID == "" {
			return &config.ClientError{Msg: "--alias-id is required"}
		}
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		req := messaging_api.UpdateRichMenuAliasRequest{RichMenuId: richMenuID}
		if _, err := api.UpdateRichMenuAlias(aliasID, &req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu alias updated", map[string]string{
			"richMenuAliasId": aliasID,
			"richMenuId":      richMenuID,
		})
		return nil
	},
}

func init() {
	updateCmd.Flags().String("alias-id", "", "alias ID (required)")
	updateCmd.Flags().String("rich-menu-id", "", "new rich menu ID (required)")
	AliasCmd.AddCommand(updateCmd)
}
