package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var setDefaultCmd = &cobra.Command{
	Use:   "set-default",
	Short: "Set the default rich menu for all users",
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
		if _, err := api.SetDefaultRichMenu(richMenuID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Default rich menu set", map[string]string{"richMenuId": richMenuID})
		return nil
	},
}

func init() {
	setDefaultCmd.Flags().String("rich-menu-id", "", "rich menu ID (required)")
	RichMenuCmd.AddCommand(setDefaultCmd)
}
