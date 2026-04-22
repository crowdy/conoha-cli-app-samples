package alias

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var createCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a rich menu alias",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		aliasID, _ := cmd.Flags().GetString("alias-id")
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")

		var req messaging_api.CreateRichMenuAliasRequest
		if payloadFile != "" {
			if err := payload.LoadJSON(payloadFile, &req); err != nil {
				return err
			}
		}
		if aliasID != "" {
			req.RichMenuAliasId = aliasID
		}
		if richMenuID != "" {
			req.RichMenuId = richMenuID
		}
		if req.RichMenuAliasId == "" {
			return &config.ClientError{Msg: "--alias-id (or payload richMenuAliasId) is required"}
		}
		if req.RichMenuId == "" {
			return &config.ClientError{Msg: "--rich-menu-id (or payload richMenuId) is required"}
		}

		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.CreateRichMenuAlias(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}
		p.Success("Rich menu alias created", map[string]string{
			"richMenuAliasId": req.RichMenuAliasId,
			"richMenuId":      req.RichMenuId,
		})
		return nil
	},
}

func init() {
	createCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin)")
	createCmd.Flags().String("alias-id", "", "alias ID (overrides payload)")
	createCmd.Flags().String("rich-menu-id", "", "rich menu ID (overrides payload)")
	AliasCmd.AddCommand(createCmd)
}
