package message

import (
	"fmt"
	"strings"

	"line-cli-go/internal/client"
	"line-cli-go/internal/config"
	"line-cli-go/internal/output"

	"github.com/line/line-bot-sdk-go/v8/linebot/messaging_api"
	"github.com/spf13/cobra"
)

var multicastCmd = &cobra.Command{
	Use:   "multicast",
	Short: "Send a message to multiple users",
	RunE: func(cmd *cobra.Command, args []string) error {
		toStr, _ := cmd.Flags().GetString("to")
		text, _ := cmd.Flags().GetString("text")
		payloadFile, _ := cmd.Flags().GetString("payload-file")

		if toStr == "" {
			return &config.ClientError{Msg: "--to is required (comma-separated user IDs)"}
		}
		to := strings.Split(toStr, ",")
		p := output.NewPrinter(config.JSONMode(), nil)

		msgs, err := buildMessages(text, payloadFile)
		if err != nil {
			return err
		}

		api, err := client.NewMessagingAPI()
		if err != nil {
			return err
		}

		_, err = api.Multicast(
			&messaging_api.MulticastRequest{
				To:       to,
				Messages: msgs,
			},
			"",
		)
		if err != nil {
			p.Error(output.ExtractHTTPStatus(err), err.Error())
			return err
		}

		p.Success("Multicast sent", map[string]string{
			"recipients": fmt.Sprintf("%d", len(to)),
		})
		return nil
	},
}

func init() {
	multicastCmd.Flags().String("to", "", "comma-separated user IDs (required)")
	multicastCmd.Flags().String("text", "", "text message content")
	multicastCmd.Flags().String("payload-file", "", "JSON file with message payload")
}
