package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var unlinkCmd = &cobra.Command{
	Use:   "unlink",
	Short: "Unlink the rich menu from a user",
	RunE: func(cmd *cobra.Command, args []string) error {
		userID, _ := cmd.Flags().GetString("user-id")
		if userID == "" {
			return &config.ClientError{Msg: "--user-id is required"}
		}
		p := output.NewPrinter(config.JSONMode(), nil)
		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}
		if _, err := api.UnlinkRichMenuIdFromUser(userID); err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Success("Rich menu unlinked", map[string]string{"userId": userID})
		return nil
	},
}

func init() {
	unlinkCmd.Flags().String("user-id", "", "user ID (required)")
	_ = unlinkCmd.MarkFlagRequired("user-id")
	RichMenuCmd.AddCommand(unlinkCmd)
}
