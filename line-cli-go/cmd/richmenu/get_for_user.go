package richmenu

import (
	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/spf13/cobra"
)

var getForUserCmd = &cobra.Command{
	Use:   "get-for-user",
	Short: "Get the rich menu ID linked to a user",
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
		resp, err := api.GetRichMenuIdOfUser(userID)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}
		p.Raw(resp)
		return nil
	},
}

func init() {
	getForUserCmd.Flags().String("user-id", "", "user ID (required)")
	RichMenuCmd.AddCommand(getForUserCmd)
}
