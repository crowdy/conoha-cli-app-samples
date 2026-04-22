package richmenu

import (
	"strconv"
	"strings"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"
	"line-cli-go/internal/payload"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var bulkLinkCmd = &cobra.Command{
	Use:   "bulk-link",
	Short: "Link a rich menu to multiple users",
	RunE: func(cmd *cobra.Command, args []string) error {
		payloadFile, _ := cmd.Flags().GetString("payload-file")
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		userIDsCSV, _ := cmd.Flags().GetString("user-ids")

		var req messaging_api.RichMenuBulkLinkRequest
		if payloadFile != "" {
			if err := payload.LoadJSON(payloadFile, &req); err != nil {
				return err
			}
		}
		if richMenuID != "" {
			req.RichMenuId = richMenuID
		}
		if userIDsCSV != "" {
			req.UserIds = splitCSV(userIDsCSV)
		}
		if req.RichMenuId == "" {
			return &config.ClientError{Msg: "--rich-menu-id (or payload richMenuId) is required"}
		}
		if len(req.UserIds) == 0 {
			return &config.ClientError{Msg: "--user-ids (or payload userIds) is required"}
		}

		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.LinkRichMenuIdToUsers(&req); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Bulk link accepted", map[string]string{
			"richMenuId": req.RichMenuId,
			"userCount":  strconv.Itoa(len(req.UserIds)),
		})
		return nil
	},
}

func init() {
	bulkLinkCmd.Flags().String("payload-file", "", "path to JSON payload (use '-' for stdin)")
	bulkLinkCmd.Flags().String("rich-menu-id", "", "rich menu ID (overrides payload)")
	bulkLinkCmd.Flags().String("user-ids", "", "comma-separated user IDs (overrides payload)")
	RichMenuCmd.AddCommand(bulkLinkCmd)
}

// splitCSV is shared by bulk-link and bulk-unlink (same package).
func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
