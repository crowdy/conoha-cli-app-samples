package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var linkCmd = &cobra.Command{
	Use:   "link",
	Short: "Link a rich menu to a user",
	RunE: func(cmd *cobra.Command, args []string) error {
		userID, _ := cmd.Flags().GetString("user-id")
		richMenuID, _ := cmd.Flags().GetString("rich-menu-id")
		if userID == "" {
			return &config.ClientError{Msg: "--user-id is required"}
		}
		if richMenuID == "" {
			return &config.ClientError{Msg: "--rich-menu-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.LinkRichMenuIdToUser(userID, richMenuID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu linked", map[string]string{"userId": userID, "richMenuId": richMenuID})
		return nil
	},
}

func init() {
	linkCmd.Flags().String("user-id", "", "user ID (required)")
	linkCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	_ = linkCmd.MarkFlagRequired("user-id")
	_ = linkCmd.MarkFlagRequired("rich-menu-id")
	RichMenuCmd.AddCommand(linkCmd)
}
