package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var deleteCmd = &cobra.Command{
	Use:   "delete",
	Short: "Delete a rich menu",
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
		if _, err := api.DeleteRichMenu(richMenuID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu deleted", map[string]string{"richMenuId": richMenuID})
		return nil
	},
}

func init() {
	deleteCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	RichMenuCmd.AddCommand(deleteCmd)
}
