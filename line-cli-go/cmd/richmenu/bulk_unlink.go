package richmenu

import (
	"strconv"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var bulkUnlinkCmd = &cobra.Command{
	Use:   "bulk-unlink",
	Short: "Unlink rich menus from multiple users",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		userIDsCSV, _ := cmd.Flags().GetString("user-ids")

		var req messaging_api.RichMenuBulkUnlinkRequest
		if payloadFile != "" {
			if err := payload.LoadJSON(payloadFile, &req); err != nil {
				return err
			}
		}
		if userIDsCSV != "" {
			req.UserIds = splitCSV(userIDsCSV)
		}
		if len(req.UserIds) == 0 {
			return &config.ClientError{Msg: "--user-ids (or payload userIds) is required"}
		}

		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.UnlinkRichMenuIdFromUsers(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return output.Printed(err)
		}
		p.Success("Bulk unlink accepted", map[string]string{
			"userCount": strconv.Itoa(len(req.UserIds)),
		})
		return nil
	},
}

func init() {
	bulkUnlinkCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin)")
	bulkUnlinkCmd.Flags().String("user-ids", "", "comma-separated user IDs (overrides payload)")
	RichMenuCmd.AddCommand(bulkUnlinkCmd)
}
